/**
 * search.collect: raspa as fontes em ordem, da mais certeira para a mais lenta, até achar cupom útil.
 *  1. agregadores (ofertas do produto no Pelando + cupons das lojas) — analisados aqui mesmo, em segundos
 *  2. só se nada útil apareceu: YouTube + Telegram, em lotes na fila de análise
 */
import type { Platform } from "@cupons/contracts";
import { MIN_CONFIDENCE, platformOf } from "@cupons/core";
import { embed } from "@cupons/ai";
import { getQueue, one, query, QUEUES, toVector, CollectJob } from "@cupons/db";
import { collectAggregators, collectTelegram, collectYoutube, CreatorContent, SourceResult, youtubeEnabled } from "@cupons/sources";
import { analyzeBatch } from "./analyze";

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

  // 1. Agregadores: rápido e certeiro
  const ctx = { id: productId, name: product.name, referencePrice: null };
  const stores = await storesOf(searchId, productId);
  const found = await timed(searchId, "agregadores", () => collectAggregators(product.name, stores));
  const batchesA = chunk(found);
  await Promise.all(batchesA.map((b) => analyzeBatch(ctx, b).catch((e) => console.error("analyze agregadores:", (e as Error).message))));
  if (await hasUsefulCoupon(productId)) {
    const why = "cupom útil já encontrado nos agregadores";
    await sourceRun(searchId, "youtube", "skipped", 0, 0, why);
    await sourceRun(searchId, "telegram", "skipped", 0, 0, why);
    await query("UPDATE searches SET status = 'linking', pending = 0 WHERE id = $1", [searchId]);
    await (await getQueue()).send(QUEUES.link, { searchId, productId });
    return;
  }

  // 2. YouTube primeiro: as descrições alimentam a descoberta de canais do Telegram
  const videos = youtubeEnabled() ? await timed(searchId, "youtube", () => collectYoutube(product.name)) : [];
  if (!youtubeEnabled()) await sourceRun(searchId, "youtube", "skipped", 0, 0, "defina YOUTUBE_API_KEY");
  const posts = await timed(searchId, "telegram", () => collectTelegram(product.name));

  const batches = chunk([...posts, ...videos]);
  const queue = await getQueue();
  if (!batches.length) {
    await query("UPDATE searches SET status = 'linking', pending = 0 WHERE id = $1", [searchId]);
    await queue.send(QUEUES.link, { searchId, productId });
    return;
  }
  await query("UPDATE searches SET status = 'analyzing', pending = $2 WHERE id = $1", [searchId, batches.length]);
  for (const batch of batches) await queue.send(QUEUES.analyze, { searchId, productId, batch }, { retryLimit: 2, retryDelay: 10 });
}

function chunk(items: CreatorContent[]): CreatorContent[][] {
  const out: CreatorContent[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

/** Lojas onde o produto está à venda: a página de origem primeiro, depois as listings conhecidas. */
async function storesOf(searchId: string, productId: string): Promise<Platform[]> {
  const origin = await one<{ url: string | null }>("SELECT page->>'url' AS url FROM searches WHERE id = $1", [searchId]);
  const listed = await query<{ platform: Platform }>("SELECT DISTINCT platform FROM listings WHERE product_id = $1", [productId]);
  const all = [platformOf(null, origin?.url), ...listed.map((l) => l.platform)].filter((p): p is Platform => Boolean(p));
  return [...new Set(all.length ? all : (["Mercado Livre", "Amazon"] as Platform[]))].slice(0, 3);
}

async function hasUsefulCoupon(productId: string): Promise<boolean> {
  return Boolean(await one(
    `SELECT 1 FROM product_coupons pc JOIN coupons c ON c.id = pc.coupon_id
     WHERE pc.product_id = $1 AND pc.applies AND pc.confidence >= $2
       AND c.last_seen_at > now() - make_interval(days => $3) LIMIT 1`,
    [productId, MIN_CONFIDENCE, Number(process.env.COUPON_HOT_DAYS ?? 14)]));
}
