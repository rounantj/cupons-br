/** Worker: consome as filas do pg-boss (Postgres). Sem HTTP. */
import { cacheSweep, getQueue, one, query, QUEUES, AnalyzeJob, CollectJob, LinkJob } from "@cupons/db";
import { CreatorContent } from "@cupons/sources";
import { analyzeBatch } from "./analyze";
import { handleCollect, sourceRun } from "./collect";
import { handleLink } from "./link";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function fail(searchId: string, e: Error) {
  await query("UPDATE searches SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [searchId, e.message.slice(0, 500)]);
}

async function main() {
  const queue = await getQueue();
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);

  await queue.work<CollectJob>(QUEUES.collect, async ([job]) => {
    const t0 = Date.now();
    try {
      await handleCollect(job.data);
      log(`collect ${job.data.searchId} (${job.data.mode}) em ${Date.now() - t0} ms`);
    } catch (e) {
      await fail(job.data.searchId, e as Error);
      throw e;
    }
  });

  for (let i = 0; i < concurrency; i++) {
    await queue.work<AnalyzeJob>(QUEUES.analyze, { includeMetadata: true }, async ([job]) => {
      const { searchId, productId, batch } = job.data;
      const t0 = Date.now();
      const p = await one<{ name: string; reference_price: number | null }>(
        `SELECT p.name, (s.page->>'price')::numeric AS reference_price FROM products p JOIN searches s ON s.id = $2 WHERE p.id = $1`,
        [productId, searchId]);
      try {
        const r = await analyzeBatch({ id: productId, name: p!.name, referencePrice: p!.reference_price ? Number(p!.reference_price) : null },
          batch as CreatorContent[]);
        log(`analyze ${searchId}: ${batch.length} conteúdos, ${r.items} itens da IA, ${r.saved} gravados em ${Date.now() - t0} ms`);
      } catch (e) {
        // lote perdido não trava a busca: registra e segue (pg-boss já tentou de novo)
        if (job.retryCount >= job.retryLimit) await sourceRun(searchId, `ia_lote_${job.id.slice(0, 8)}`, "error", 0, Date.now() - t0, (e as Error).message);
        else throw e;
      }
      // o último lote a terminar dispara a geração de links
      const left = await one<{ pending: number }>(
        "UPDATE searches SET pending = pending - 1 WHERE id = $1 RETURNING pending", [searchId]);
      if (left && left.pending <= 0) {
        await query("UPDATE searches SET status = 'linking' WHERE id = $1", [searchId]);
        await queue.send(QUEUES.link, { searchId, productId });
      }
    });
  }

  await queue.work<LinkJob>(QUEUES.link, async ([job]) => {
    try {
      await handleLink(job.data);
      log(`link ${job.data.searchId}: busca concluída`);
    } catch (e) {
      await fail(job.data.searchId, e as Error);
      throw e;
    }
  });

  await queue.schedule(QUEUES.maintenance, "*/15 * * * *");
  await queue.work(QUEUES.maintenance, async () => {
    log(`cache: ${await cacheSweep()} entradas expiradas removidas`);
    // retenção prometida na política de privacidade: contexto das buscas (URL da página) por 90 dias
    const old = await query("DELETE FROM searches WHERE created_at < now() - interval '90 days' RETURNING 1");
    if (old.length) log(`retenção: ${old.length} buscas com mais de 90 dias removidas`);
  });
  log(`worker pronto (análise com ${concurrency} consumidores)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
