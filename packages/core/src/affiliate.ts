/**
 * Página de produto -> NOSSO link de afiliado.
 * productOf() extrai plataforma + id do produto de uma URL já resolvida, descartando o rastreio de quem divulgou.
 * Vitrines de outros afiliados (/social/...), buscas e sites estrangeiros não são página de produto.
 */
import type { Platform } from "@cupons/contracts";

export interface ProductRef { platform: Platform; externalId: string; url: string }

export interface AffiliateCredentials {
  amazonTag?: string;
  mlWord?: string;
  mlTool?: string;
  awinPublisherId?: string;
  magaluStore?: string;
  shopeeEnabled?: boolean;
}

/** Lojas da rede Awin (awinmid). Novas entram ao ver links reais (learnAwin). */
export const AWIN_MERCHANTS: Record<string, string> = { "kabum.com.br": "17729" };

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AffiliateCredentials {
  return {
    amazonTag: env.AMAZON_AFFILIATE_TAG || undefined,
    mlWord: env.ML_AFFILIATE_WORD || undefined,
    mlTool: env.ML_AFFILIATE_TOOL || undefined,
    awinPublisherId: env.AWIN_PUBLISHER_ID || undefined,
    magaluStore: env.MAGALU_STORE || undefined,
    shopeeEnabled: Boolean(env.SHOPEE_APP_ID && env.SHOPEE_SECRET),
  };
}

function unwrap(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("awin1.com") && u.searchParams.get("ued")) {
      const store = u.searchParams.get("ued")!;
      const mid = u.searchParams.get("awinmid");
      const host = new URL(store).hostname.replace(/^www\./, "");
      if (mid && !AWIN_MERCHANTS[host]) AWIN_MERCHANTS[host] = mid;
      return store;
    }
  } catch { /* URL inválida */ }
  return url;
}

export function productOf(rawUrl: string): ProductRef | null {
  let u: URL;
  try { u = new URL(unwrap(rawUrl)); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname;
  let m: RegExpMatchArray | null;
  if (host.startsWith("amazon.com.br") && (m = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)))
    return { platform: "Amazon", externalId: m[1], url: `https://www.amazon.com.br/dp/${m[1]}` };
  if (host.endsWith("mercadolivre.com.br")) {
    if ((m = path.match(/\/p\/(MLB\d+)/)))
      return { platform: "Mercado Livre", externalId: m[1], url: `https://www.mercadolivre.com.br/p/${m[1]}` };
    if ((m = path.match(/(MLB)-?(\d{6,})/)))
      return { platform: "Mercado Livre", externalId: `MLB${m[2]}`, url: `https://${host}${path}` };
    return null;
  }
  if (host.endsWith("shopee.com.br") && (m = path.match(/(?:\/product)?\/(\d{3,})\/(\d{3,})(?:\/|$)/)) ||
      host.endsWith("shopee.com.br") && (m = path.match(/-i\.(\d{3,})\.(\d{3,})/)))
    return { platform: "Shopee", externalId: `${m[1]}/${m[2]}`, url: `https://shopee.com.br/product/${m[1]}/${m[2]}` };
  if (host.endsWith("kabum.com.br") && (m = path.match(/\/produto\/(\d+)/)))
    return { platform: "KaBuM!", externalId: m[1], url: `https://www.kabum.com.br/produto/${m[1]}` };
  if ((host.endsWith("magazineluiza.com.br") || host.endsWith("magazinevoce.com.br")) && (m = path.match(/\/p\/([a-z0-9]+)\/?/i)))
    return { platform: "Magalu", externalId: m[1], url: `https://www.magazineluiza.com.br/p/${m[1]}/` };
  return null;
}

/** NOSSO link. Shopee depende de API (feito no worker); aqui só sinaliza. */
export function ourLink(p: ProductRef, c: AffiliateCredentials): { url: string | null; missing: string | null; needsShopeeApi?: boolean } {
  switch (p.platform) {
    case "Amazon":
      return c.amazonTag ? { url: `${p.url}?tag=${encodeURIComponent(c.amazonTag)}`, missing: null } : { url: null, missing: "AMAZON_AFFILIATE_TAG" };
    case "Mercado Livre":
      return c.mlWord && c.mlTool
        ? { url: `${p.url}?${new URLSearchParams({ matt_word: c.mlWord, matt_tool: c.mlTool })}`, missing: null }
        : { url: null, missing: "ML_AFFILIATE_WORD / ML_AFFILIATE_TOOL" };
    case "Shopee":
      return c.shopeeEnabled ? { url: null, missing: null, needsShopeeApi: true } : { url: null, missing: "SHOPEE_APP_ID / SHOPEE_SECRET" };
    case "Magalu":
      return c.magaluStore
        ? { url: `https://www.magazinevoce.com.br/magazine${c.magaluStore}/p/${p.externalId}/`, missing: null }
        : { url: null, missing: "MAGALU_STORE" };
  }
  const host = new URL(p.url).hostname.replace(/^www\./, "");
  const mid = AWIN_MERCHANTS[host];
  if (mid) {
    return c.awinPublisherId
      ? { url: `https://www.awin1.com/cread.php?awinmid=${mid}&awinaffid=${c.awinPublisherId}&ued=${encodeURIComponent(p.url)}`, missing: null }
      : { url: null, missing: "AWIN_PUBLISHER_ID" };
  }
  return { url: null, missing: "plataforma sem programa de afiliado" };
}
