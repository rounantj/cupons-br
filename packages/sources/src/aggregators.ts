/**
 * Agregadores abertos de cupons (Pelando, Promobit) — só páginas que o robots.txt libera.
 *  - Pelando /busca/<termo>: ofertas DO PRODUTO; a página da oferta traz o cupom usado nele (o cupom útil).
 *  - Pelando /cupons-de-descontos/<loja> e Promobit /cupons/loja/<loja>/: cupons da loja com o escopo escrito
 *    ("itens Selecionados Bebês", "Lojas Oficiais") — a análise descarta os que não servem para o produto.
 * Promobit /buscar é proibido no robots.txt: não usamos.
 */
import type { Platform } from "@cupons/contracts";
import { modelConflict, platformOf, productMismatch } from "@cupons/core";
import { cacheGet, cacheSet } from "@cupons/db";
import { getText } from "./http";
import { CreatorContent, SourceResult } from "./types";

const PELANDO = "https://www.pelando.com.br";
const PROMOBIT = "https://www.promobit.com.br";
const HOT_MS = Number(process.env.COUPON_HOT_DAYS ?? 14) * 86400_000;
const MAX_DEALS = 6;

const PELANDO_STORES: Partial<Record<Platform, string>> = {
  "Mercado Livre": "mercado-livre", Amazon: "amazon", Shopee: "shopee", Magalu: "magalu",
};
const PROMOBIT_STORES: Partial<Record<Platform, string>> = {
  "Mercado Livre": "mercado-livre", Amazon: "amazon", Shopee: "shopee", Magalu: "magazine-luiza",
  "KaBuM!": "kabum", "Casas Bahia": "casas-bahia", Americanas: "americanas",
};

async function page(url: string, ttlSeconds: number): Promise<string> {
  const key = `agg:${url}`;
  const hit = await cacheGet<string>(key);
  if (hit !== null) return hit;
  const html = await getText(url);
  await cacheSet(key, html, ttlSeconds);
  return html;
}

const unescape = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (html: string) => unescape(html.replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();

/** Props das ilhas Astro do Pelando: cada valor vem como [tipo, valor] (0 = simples, 1 = lista). */
function astro(v: any): any {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") {
    if (v[0] === 1) return (v[1] as any[]).map(astro);
    return v[0] === 0 && v[1] && typeof v[1] === "object" ? astro(v[1]) : v[1];
  }
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, astro(x)]));
  return v;
}

/** "iPhone 18 Pro Max 512GB Bordô - Distribuidor Autorizado" -> "iPhone 18 Pro Max 512GB Bordô" */
export function shortName(name: string): string {
  return name.split(/\s[-|–—]\s|,|\(/)[0].split(/\s+/).slice(0, 7).join(" ").trim();
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

interface PelandoDeal { slug: string; title: string; price: number | null; temperature: number; status: string; createdAt: string; sourceUrl: string; store?: { name: string } }

/** Ofertas do produto no Pelando que vieram com cupom. */
async function pelandoDeals(productName: string): Promise<{ items: CreatorContent[]; seen: number }> {
  const term = shortName(productName);
  // busca larga ("iPhone 18 Pro Max"); o filtro abaixo confere números e modelo com o nome completo
  const html = await page(`${PELANDO}/busca/${slug(term.split(" ").slice(0, 4).join(" "))}`, 20 * 60);
  const m = html.match(/component-export="SearchFeedContent"[^>]*props="([^"]*)"/);
  if (!m) return { items: [], seen: 0 };
  const deals: PelandoDeal[] = astro(JSON.parse(unescape(m[1]))).initialData?.deals?.deals ?? [];
  const matching = deals.filter((d) => d.status === "active" && Date.parse(d.createdAt) > Date.now() - HOT_MS
    && platformOf(d.store?.name, d.sourceUrl) && !productMismatch(term, d.title) && !modelConflict(term, d.title));

  const items: CreatorContent[] = [];
  for (const d of matching.slice(0, MAX_DEALS)) {
    const dealHtml = await page(`${PELANDO}/d/${d.slug}`, 6 * 3600);
    const codes = [...dealHtml.matchAll(/data-code="([^"]+)"[^>]*data-status="active"/g)].map((x) => unescape(x[1]));
    if (!codes.length) continue;
    const body = textOf(dealHtml.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<astro-island[\s\S]*?<\/astro-island>/g, ""));
    const desc = body.match(/Publicado por \S+ [^A-Z]*(.*?)\s(?:Perguntar|\d+ comentários?)/)?.[1] ?? "";
    items.push({
      source: "pelando",
      sourceUrl: `${PELANDO}/d/${d.slug}`,
      title: d.title,
      creator: "Pelando",
      creatorId: `pl:${d.slug}`,
      // link do produto na mesma linha do cupom: a análise usa para saber que o cupom foi usado NESTE produto
      text: [`${d.title}${d.price ? ` por R$ ${String(d.price).replace(".", ",")}` : ""} na loja ${d.store?.name ?? ""}`,
        desc, ...codes.map((c) => `Cupom: ${c} ${d.sourceUrl}`)].filter(Boolean).join("\n"),
      comments: [],
      publishedAt: new Date(d.createdAt).toISOString(),
      live: false,
      votes: d.temperature,
    });
  }
  return { items, seen: matching.length };
}

/** Cupons da loja no Pelando (cards com código, escopo e temperatura). */
async function pelandoStore(platform: Platform): Promise<CreatorContent[]> {
  const store = PELANDO_STORES[platform];
  if (!store) return [];
  const html = await page(`${PELANDO}/cupons-de-descontos/${store}`, 30 * 60);
  return [...html.matchAll(/<article class="card"[\s\S]*?<\/article>/g)].flatMap(([card]) => {
    const code = card.match(/data-copy-code="([^"]+)"/)?.[1];
    if (!code || !/data-status="active"/.test(card) || card.includes("card__expired-badge")) return [];
    const title = textOf(card.match(/card__title"[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "");
    const desc = textOf(card.match(/card__description"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
    const temp = Number(unescape(card).match(/"initialTemperature":\[0,(-?[\d.]+)\]/)?.[1] ?? 0);
    const id = card.match(/data-deal-id="([^"]+)"/)?.[1] ?? code;
    return [{
      source: "pelando" as const,
      sourceUrl: `${PELANDO}/cupons-de-descontos/${store}#${id}`,
      title,
      creator: "Pelando",
      creatorId: `pl:${id}`,
      text: `${title} · ${desc} · Cupom ${platform}: ${unescape(code)}`, // uma linha: regras ficam "perto do código"
      comments: [],
      publishedAt: new Date().toISOString(), // a lista não traz data exata; só cupons ativos aparecem nela
      live: false,
      votes: temp,
    }];
  });
}

/** Cupons da loja no Promobit (JSON do Next com regras completas e validade). */
async function promobitStore(platform: Platform): Promise<CreatorContent[]> {
  const store = PROMOBIT_STORES[platform];
  if (!store) return [];
  const html = await page(`${PROMOBIT}/cupons/loja/${store}/`, 30 * 60);
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) return [];
  const coupons: any[] = JSON.parse(json).props?.pageProps?.serverCoupons?.coupons ?? [];
  return coupons.flatMap((c) => {
    if (!c.couponCode || c.couponStatusName !== "APPROVED") return [];
    if (c.couponUntil && Date.parse(c.couponUntil.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) < Date.now()) return [];
    const published = new Date(String(c.couponPublished).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (published.getTime() < Date.now() - HOT_MS) return [];
    return [{
      source: "promobit" as const,
      sourceUrl: `${PROMOBIT}/cupons/loja/${store}/#${c.couponId}`,
      title: c.couponTitle ?? "",
      creator: "Promobit",
      creatorId: `pb:${c.couponId}`,
      text: `${c.couponTitle} · ${c.couponInstructions ?? ""} · Cupom ${platform}: ${c.couponCode}`,
      comments: [],
      publishedAt: published.toISOString(),
      live: false,
    }];
  });
}

/** Etapa rápida da coleta: ofertas do produto + cupons das lojas onde ele está à venda. */
export async function collectAggregators(productName: string, platforms: Platform[]): Promise<SourceResult> {
  const settled = await Promise.allSettled([
    pelandoDeals(productName),
    ...platforms.map((p) => pelandoStore(p)),
    ...platforms.map((p) => promobitStore(p)),
  ]);
  const errors = settled.filter((s) => s.status === "rejected").map((s) => String((s as PromiseRejectedResult).reason).slice(0, 80));
  const [deals, ...stores] = settled;
  const dealItems = deals.status === "fulfilled" ? deals.value : { items: [], seen: 0 };
  const storeItems = stores.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  // mesmo código na mesma loja: fica a primeira aparição (Pelando com votos antes do Promobit)
  const seenCodes = new Set(dealItems.items.flatMap((i) => [...i.text.matchAll(/Cupom: (\S+)/g)].map((x) => x[1].toLowerCase())));
  const unique = storeItems.filter((i) => {
    const code = i.text.match(/Cupom [^:]+: (\S+)$/m)?.[1]?.toLowerCase();
    if (!code || seenCodes.has(code)) return false;
    seenCodes.add(code);
    return true;
  });
  return {
    items: [...dealItems.items, ...unique],
    detail: `${dealItems.seen} ofertas do produto (${dealItems.items.length} com cupom), ${unique.length} cupons de loja`
      + ` [${platforms.join(", ")}]${errors.length ? ` · erros: ${errors.join("; ")}` : ""}`,
  };
}
