/**
 * Análise de um lote de conteúdos de influenciador: a IA extrai, o código decide.
 * Regras vindas do POC (cada uma corrigiu um erro real observado):
 *  - código precisa existir no texto e ser digitável ("Santander", "cupom-amazon" não são)
 *  - plataforma conhecida obrigatória (loja desconhecida = patrocínio do canal)
 *  - termos do código vêm da linha dele (ou da anterior/seguinte), não da IA
 *  - restrição citada pela IA precisa existir no texto; categoria no nome do código (CASA3010) bloqueia
 *  - cupom de outro modelo (link "iphone-17-pro" na busca "iPhone 17") não vale
 *  - preço só em R$, link nacional, trecho precisa citar o produto e o modelo certo
 *  - cupom de influenciador sem link de produto (vitrine/campanha) vale só em "produtos selecionados":
 *    no teste real, COMPRAS e AQUITEMTECH (ML, "15% até R$500") não aplicaram num iPhone
 *  - sinal de comentário só quando há comentários (Telegram não tem; a IA inventava "funcionou")
 *  - agregadores (Pelando/Promobit): cupom de loja sem restrição escrita vale como geral; votos da comunidade pesam
 */
import { CREATOR_SCHEMA, CREATOR_SYSTEM, CreatorItem, FIT_SCHEMA, FIT_SYSTEM, chatJson } from "@cupons/ai";
import {
  FOREIGN_URL, SELECTED, brlAmounts, categoryRule, expiredByCode, cleanStore, codeCategory, commentSignal, couponForOtherModel, isCode, linesNear, modelConflict,
  platformOf, productMismatch, productOf, scopeFromText, titleMatches, termsNearCode, verifiedRestriction,
} from "@cupons/core";
import { cached, one, query } from "@cupons/db";
import { CreatorContent, resolveUrl, shortName } from "@cupons/sources";

export interface ProductCtx { id: string; name: string; referencePrice: number | null }

const SIGNAL: Record<string, [number, string]> = {
  works: [0.15, "comentários confirmam que funcionou"],
  fails: [-0.5, "comentários dizem que não funciona/esgotou"],
  mixed: [-0.15, "comentários divergem"],
};

function describe(i: number, c: CreatorContent): string {
  const lines = [`[${i}] canal=${c.creator} | publicado=${c.publishedAt.slice(0, 10)}${c.live ? " | AO VIVO" : ""} | título=${c.title}`,
    `texto: ${c.text || "(sem trechos relevantes)"}`];
  if (c.comments.length) lines.push(`comentários: ${c.comments.slice(0, 12).join(" || ")}`);
  return lines.join("\n") + "\n";
}

const sourceText = (c: CreatorContent) => [c.title, c.text, ...c.comments].join("\n");

function verifiedUrl(c: CreatorContent, url: string | null, code: string | null): string | null {
  const text = sourceText(c);
  let u = (url ?? "").trim();
  if (!u.startsWith("http") || !text.includes(u)) {
    const near = code ? linesNear(c.text, code).join("\n").match(/https?:\/\/\S+/) : null;
    u = near?.[0] ?? "";
  }
  return u && !FOREIGN_URL.test(u) ? u : null;
}

/** "O produto pertence à categoria X?" — pergunta binária isolada, cacheada por produto+categoria. */
async function categoryFits(productName: string, category: string): Promise<boolean> {
  const rule = categoryRule(productName, category);
  if (rule !== null) return rule;
  return cached(`fit:${productName.toLowerCase()}:${category}`, 30 * 86400, async () => {
    const { data } = await chatJson<{ items: { category: string; fits: boolean }[] }>(
      FIT_SYSTEM, `PRODUTO: ${productName}\nCATEGORIAS:\n- ${category}`, FIT_SCHEMA);
    return data.items.find((x) => x.category.toLowerCase() === category)?.fits ?? false;
  });
}

function adjust(c: CreatorContent, it: CreatorItem, code: string | null, confidence: number, reason: string): [number, string] {
  const signal = !c.comments.length ? null
    : commentSignal(c.comments, code) ?? (it.comment_signal !== "none" ? it.comment_signal : null);
  let delta = 0;
  if (signal && SIGNAL[signal]) {
    delta += SIGNAL[signal][0];
    reason += ` · ${SIGNAL[signal][1]}`;
  }
  if (c.votes !== undefined && c.votes < 0) {
    delta -= 0.5;
    reason += ` · comunidade esfriou (${c.votes}°)`;
  } else if ((c.votes ?? 0) >= 100) {
    delta += 0.1;
    reason += ` · comunidade aprovou (${c.votes}°)`;
  }
  if (c.live || Date.parse(c.publishedAt) > Date.now() - 48 * 3600_000) delta += 0.05;
  return [Math.max(0.05, Math.min(0.95, confidence + delta)), reason];
}

/** Página do produto anunciada (preço ou cupom com preço) -> listing. */
async function saveListing(p: ProductCtx, c: CreatorContent, url: string | null, price: number | null, title: string) {
  if (!url) return;
  const ref = productOf(await resolveUrl(url));
  if (!ref) return;
  await query(
    `INSERT INTO listings (product_id, platform, external_id, url, title, price, price_seen_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::numeric IS NULL THEN NULL ELSE $7::timestamptz END, $8)
     ON CONFLICT (platform, external_id) DO UPDATE SET
       price = CASE WHEN EXCLUDED.price_seen_at >= coalesce(listings.price_seen_at, 'epoch') THEN coalesce(EXCLUDED.price, listings.price) ELSE listings.price END,
       price_seen_at = greatest(listings.price_seen_at, EXCLUDED.price_seen_at),
       title = coalesce(listings.title, EXCLUDED.title), updated_at = now()
     WHERE listings.product_id = EXCLUDED.product_id`,
    [p.id, ref.platform, ref.externalId, ref.url, title.slice(0, 200), price, c.publishedAt, c.source],
  );
}

async function priceItem(p: ProductCtx, c: CreatorContent, it: CreatorItem): Promise<boolean> {
  const price = it.price;
  if (!price || !it.product_match) return false;
  const text = sourceText(c);
  if (!brlAmounts(text).some((v) => Math.abs(v - price) < 1)) return false; // precisa estar escrito em R$
  const lines = c.text.split("\n");
  const idx = lines.flatMap((l, i) => (brlAmounts(l).some((v) => Math.abs(v - price) < 1) ? [i] : []));
  const priceLines = idx.map((i) => lines[i]).join("\n");
  const context = [...new Set(idx.flatMap((i) => [i - 2, i - 1, i, i + 1, i + 2]))].filter((j) => j >= 0 && j < lines.length).map((j) => lines[j]);
  if (brlAmounts(c.title).some((v) => Math.abs(v - price) < 1)) context.push(c.title);
  if (productMismatch(p.name, context.join("\n") || c.title) || modelConflict(p.name, priceLines || c.title)) return false;
  if (p.referencePrice && price < 0.35 * p.referencePrice) return false; // provável acessório
  const url = verifiedUrl(c, it.url, null);
  if (!platformOf(cleanStore(it.store), url)) return false;
  await saveListing(p, c, url, price, c.title);
  return true;
}

interface CouponDecision { applies: boolean; confidence: number; reason: string }

const SITEWIDE = /todo (o )?site|site todo|site inteiro|qualquer produto/i;
const AGGREGATOR = new Set(["pelando", "promobit"]);
/** Oferta de um produto no Pelando: o cupom foi usado naquele produto ("selecionados" inclui ele). */
const isDeal = (c: CreatorContent) => c.source === "pelando" && c.sourceUrl.includes("/d/");
const label = (c: CreatorContent) => (c.source === "pelando" ? "Pelando" : "Promobit");

/** Sem restrição explícita: o link do post diz para que o cupom foi divulgado. */
async function scope(p: ProductCtx, c: CreatorContent, url: string | null, near: string): Promise<CouponDecision> {
  const ref = url ? productOf(await resolveUrl(url)) : null;
  if (ref) {
    if (isDeal(c) ? !titleMatches(shortName(p.name), c.title) : productMismatch(shortName(p.name), `${c.title}\n${c.text}`))
      return { applies: true, confidence: 0.25, reason: "divulgado junto com outro produto — confira no carrinho" };
    return { applies: true, confidence: AGGREGATOR.has(c.source) ? 0.8 : 0.75,
      reason: AGGREGATOR.has(c.source) ? `usado neste produto (oferta no ${label(c)})` : "divulgado junto com este produto" };
  }
  // cupom de loja num agregador: o escopo vem escrito ("Selecionados", "itens de Casa"); sem escopo = geral
  // Promobit usa texto-modelo ("15% OFF em suas compras") até para cupom de marca (STANLEY15): sozinho não basta
  if (c.source === "pelando") return { applies: true, confidence: 0.65, reason: "cupom da loja sem restrição (Pelando)" };
  if (c.source === "promobit") return { applies: true, confidence: 0.5, reason: "cupom da loja no Promobit, sem escopo confirmado" };
  return SITEWIDE.test(near)
    ? { applies: true, confidence: 0.45, reason: "anunciado como válido no site todo — confira no carrinho" }
    : { applies: true, confidence: 0.3, reason: "cupom de campanha: vale em produtos selecionados — confira no carrinho" };
}

async function couponItem(p: ProductCtx, c: CreatorContent, it: CreatorItem): Promise<"saved" | "skipped"> {
  const code = (it.code ?? "").trim();
  const text = sourceText(c);
  if (!code) return (await priceItem(p, c, { ...it, price: it.price })) ? "saved" : "skipped";
  if (!text.toLowerCase().includes(code.toLowerCase()) || !isCode(code) || expiredByCode(code)) return "skipped";
  const url = verifiedUrl(c, it.url, code);
  const platform = platformOf(cleanStore(it.store), url);
  if (!platform) return "skipped"; // fora das plataformas conhecidas: patrocínio do canal

  const terms = termsNearCode(c.text, code, c.comments);
  const kind = terms.kind ?? (it.kind === "none" ? null : it.kind);
  const value = terms.kind ? terms.value : it.value;
  const cap = terms.cap ?? it.cap;
  const min = terms.min ?? it.min;
  const near = linesNear(c.text, code).join("\n");
  // cupom de loja de agregador: o escopo escrito no card vale mais que a leitura da IA
  const written = AGGREGATOR.has(c.source) && !isDeal(c) ? scopeFromText(c.text) : null;
  const restriction = written ?? verifiedRestriction(it.restricted_to, text);

  let d: CouponDecision;
  const category = codeCategory(code);
  const otherModel = couponForOtherModel(p.name, `${near} ${url ?? ""}`);
  if (category) d = { applies: false, confidence: 0, reason: `cupom de outra categoria pelo nome do código (${category})` };
  else if (otherModel) d = { applies: false, confidence: 0, reason: `cupom de outro modelo: ${otherModel}` };
  else if (it.freight_only && /frete/i.test(`${near}`)) d = { applies: false, confidence: 0, reason: "desconto só no frete" };
  else if (restriction === "?") d = { applies: false, confidence: 0, reason: "restrição citada não confirmada no texto" };
  else if (restriction && !(await categoryFits(p.name, restriction))) d = { applies: false, confidence: 0, reason: `restrito a: ${restriction}` };
  else if (restriction) d = { applies: true, confidence: SELECTED.test(near) ? 0.4 : 0.7, reason: `categoria compatível: ${restriction}` };
  else if (!isDeal(c) && SELECTED.test(AGGREGATOR.has(c.source) ? c.text : near)) d = { applies: true, confidence: 0.3, reason: "só itens elegíveis/selecionados — confira no carrinho" };
  else d = await scope(p, c, url, near);
  if (d.applies) [d.confidence, d.reason] = adjust(c, it, code, d.confidence, d.reason);
  if (it.conditions) d.reason += ` · condições: ${it.conditions}`;

  // Cupom: regras completas sobrescrevem as parciais; "quentura" = publicação mais recente vista
  const coupon = await one<{ id: string }>(
    `INSERT INTO coupons (platform, code, discount_kind, discount_value, discount_cap, min_purchase, restricted_to, conditions, terms_text, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, nullif($7, ''), nullif($8, ''), $9, $10)
     ON CONFLICT (platform, code_norm) DO UPDATE SET
       discount_kind = coalesce(coupons.discount_kind, EXCLUDED.discount_kind),
       discount_value = coalesce(coupons.discount_value, EXCLUDED.discount_value),
       discount_cap = coalesce(coupons.discount_cap, EXCLUDED.discount_cap),
       min_purchase = coalesce(coupons.min_purchase, EXCLUDED.min_purchase),
       restricted_to = coalesce(coupons.restricted_to, EXCLUDED.restricted_to),
       conditions = coalesce(coupons.conditions, EXCLUDED.conditions),
       terms_text = coalesce(coupons.terms_text, EXCLUDED.terms_text),
       last_seen_at = greatest(coupons.last_seen_at, EXCLUDED.last_seen_at)
     RETURNING id`,
    [platform, code, kind, value, cap, min, restriction === "?" ? "" : restriction, it.conditions, near.slice(0, 600), c.publishedAt],
  );
  await query(
    `INSERT INTO coupon_sightings (coupon_id, source, source_url, creator, published_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (coupon_id, source_url) DO UPDATE SET seen_at = now()`,
    [coupon!.id, c.source, c.sourceUrl, c.creator, c.publishedAt],
  );
  await query(
    `INSERT INTO product_coupons (product_id, coupon_id, applies, confidence, reason) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id, coupon_id) DO UPDATE SET
       applies = EXCLUDED.applies,
       confidence = CASE WHEN EXCLUDED.applies = product_coupons.applies THEN greatest(EXCLUDED.confidence, product_coupons.confidence) ELSE EXCLUDED.confidence END,
       reason = EXCLUDED.reason, evaluated_at = now()`,
    [p.id, coupon!.id, d.applies, d.confidence, d.reason],
  );
  if (d.applies && it.price && it.product_match) await priceItem(p, c, it);
  if (d.applies && d.confidence >= 0.5) await recordHit(c.creatorId);
  return "saved";
}

async function recordHit(creatorId: string) {
  if (!/^(tg|yt):/.test(creatorId)) return;
  if (creatorId.startsWith("tg:")) await query("UPDATE telegram_channels SET coupon_hits = coupon_hits + 1 WHERE username = $1", [creatorId.slice(3)]);
  else await query("UPDATE youtube_channels SET coupon_hits = coupon_hits + 1, last_hit_at = now() WHERE channel_id = $1", [creatorId.slice(3)]);
}

export async function analyzeBatch(p: ProductCtx, batch: CreatorContent[]): Promise<{ saved: number; items: number }> {
  const prompt = `PRODUTO: ${p.name}\n\n` + batch.map((c, i) => describe(i, c)).join("\n");
  const { data } = await chatJson<{ items: CreatorItem[] }>(CREATOR_SYSTEM, prompt, CREATOR_SCHEMA);
  let saved = 0;
  for (const it of data.items) {
    const c = batch[it.i];
    if (!c) continue;
    const result = it.type === "price" ? ((await priceItem(p, c, it)) ? "saved" : "skipped") : await couponItem(p, c, it);
    if (result === "saved") saved++;
  }
  return { saved, items: data.items.length };
}
