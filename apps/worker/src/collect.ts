/** search.collect: busca conteúdos quentes e divide em lotes para a IA. */
import { embed } from "@cupons/ai";
import { getQueue, one, query, QUEUES, toVector, CollectJob } from "@cupons/db";
import { collectTelegram, collectYoutube, CreatorContent, SourceResult, youtubeEnabled } from "@cupons/sources";

const BATCH = Number(process.env.ANALYZE_BATCH_SIZE ?? 6);

async function timed(searchId: string, source: string, fn: () => Promise<SourceResult>): Promise<CreatorContent[]> {
  const t0 = Date.now();
  try {
    const r = await fn();
    await sourceRun(searchId, source, "ok", r.items.length, Date.now() - t0, r.detail);
    return r.items;
  } catch (e) {
    await sourceRun(searchId, source, "error", 0, Date.now() - t0, (e as Error).message.slice(0, 300));
    return [];
  }
}

export async function sourceRun(searchId: string, source: string, status: string, items: number, ms: number, detail: string | null) {
  await query(
    `INSERT INTO source_runs (search_id, source, status, items, duration_ms, detail) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (search_id, source) DO UPDATE SET status = EXCLUDED.status, items = EXCLUDED.items,
       duration_ms = EXCLUDED.duration_ms, detail = EXCLUDED.detail`,
    [searchId, source, status, items, ms, detail],
  );
}

/**
 * Produto novo: antes de coletar, reaproveita cupons QUENTES (últimas 48 h) que já valeram para produtos
 * parecidos (vizinhos no vetor) — a resposta já sai com algo enquanto a coleta roda.
 */
async function reuseFromSimilar(productId: string): Promise<number> {
  const rows = await query(
    `WITH me AS (SELECT embedding FROM products WHERE id = $1 AND embedding IS NOT NULL),
     neighbors AS (
       SELECT p.id FROM products p, me WHERE p.id <> $1 AND p.embedding IS NOT NULL
       ORDER BY p.embedding <=> me.embedding LIMIT 5
     )
     INSERT INTO product_coupons (product_id, coupon_id, applies, confidence, reason)
     SELECT DISTINCT ON (pc.coupon_id) $1, pc.coupon_id, true, least(pc.confidence, 0.5), 'reaproveitado de produto parecido'
     FROM product_coupons pc JOIN neighbors n ON n.id = pc.product_id JOIN coupons c ON c.id = pc.coupon_id
     WHERE pc.applies AND c.restricted_to IS NULL AND c.last_seen_at > now() - interval '48 hours'
     ON CONFLICT DO NOTHING RETURNING 1`,
    [productId],
  );
  return rows.length;
}

export async function handleCollect(job: CollectJob) {
  const { searchId, productId, mode } = job;
  const product = await one<{ name: string; has_embedding: boolean }>(
    "SELECT name, embedding IS NOT NULL AS has_embedding FROM products WHERE id = $1", [productId]);
  if (!product) throw new Error(`produto ${productId} não existe`);
  await query("UPDATE searches SET status = 'collecting' WHERE id = $1", [searchId]);

  if (!product.has_embedding && process.env.OPENAI_API_KEY) {
    const [vec] = await embed([product.name]);
    await query("UPDATE products SET embedding = $1 WHERE id = $2", [toVector(vec), productId]);
  }
  if (mode === "full") await sourceRun(searchId, "reaproveitamento", "ok", await reuseFromSimilar(productId), 0, "cupons quentes de produtos parecidos (vetor)");

  // YouTube primeiro: as descrições alimentam a descoberta de canais do Telegram
  const videos = youtubeEnabled() ? await timed(searchId, "youtube", () => collectYoutube(product.name)) : [];
  if (!youtubeEnabled()) await sourceRun(searchId, "youtube", "skipped", 0, 0, "defina YOUTUBE_API_KEY");
  const posts = await timed(searchId, "telegram", () => collectTelegram(product.name));

  const all = [...posts, ...videos];
  const batches: CreatorContent[][] = [];
  for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
  const queue = await getQueue();
  if (!batches.length) {
    await query("UPDATE searches SET status = 'linking', pending = 0 WHERE id = $1", [searchId]);
    await queue.send(QUEUES.link, { searchId, productId });
    return;
  }
  await query("UPDATE searches SET status = 'analyzing', pending = $2 WHERE id = $1", [searchId, batches.length]);
  for (const batch of batches) await queue.send(QUEUES.analyze, { searchId, productId, batch }, { retryLimit: 2, retryDelay: 10 });
}
