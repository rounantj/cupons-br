/**
 * Identifica a página de produto: URL da loja + dados estruturados (JSON-LD Product), depois metadados,
 * depois adaptadores por loja. Funciona com informação parcial; sem nome do produto, não busca.
 */
import type { PageContext } from "@cupons/contracts";

const PRODUCT_URL: [RegExp, RegExp][] = [
  [/amazon\.com\.br$/, /\/(dp|gp\/product)\/[A-Z0-9]{10}/],
  [/mercadolivre\.com\.br$/, /\/p\/MLB\d+|MLB-?\d{6,}/],
  [/shopee\.com\.br$/, /-i\.\d+\.\d+|\/product\/\d+\/\d+/],
  [/magazineluiza\.com\.br$/, /\/p\/[a-z0-9]+\//i],
  [/kabum\.com\.br$/, /\/produto\/\d+/],
  [/casasbahia\.com\.br$/, /\/p\/\d+/],
  [/americanas\.com\.br$/, /\/produto\/\d+/],
];

export function isProductPage(loc: Location = location): boolean {
  const host = loc.hostname.replace(/^www\./, "");
  return PRODUCT_URL.some(([h, p]) => h.test(host) && p.test(loc.pathname));
}

const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() || undefined;
const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content?.trim() || undefined;

function parsePrice(raw?: string | number | null): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number") return raw > 0 ? raw : undefined;
  const s = raw.replace(/[^\d.,]/g, "");
  // "5.899,90" (BR) ou "5899.90"
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function jsonLdProduct(): Record<string, any> | null {
  for (const el of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(el.textContent || "null");
      const nodes = (Array.isArray(data) ? data : [data]).flatMap((d: any) => (d?.["@graph"] ? d["@graph"] : [d]));
      const product = nodes.find((n: any) => n && ([] as unknown[]).concat(n["@type"]).includes("Product"));
      if (product) return product;
    } catch { /* JSON-LD inválido na página */ }
  }
  return null;
}

/** Seletores de preço por loja (último recurso, quando não há JSON-LD). */
const PRICE_SELECTORS: Record<string, string[]> = {
  "amazon.com.br": ["#corePriceDisplay_desktop_feature_div .a-offscreen", "#corePrice_feature_div .a-offscreen", ".a-price .a-offscreen"],
  "mercadolivre.com.br": ['meta[itemprop="price"]', ".ui-pdp-price__second-line .andes-money-amount__fraction"],
  "shopee.com.br": ['[class*="product-price"]', 'div[class*="pqTWkA"]'],
};

export function detectProduct(): PageContext | null {
  if (!isProductPage()) return null;
  const host = location.hostname.replace(/^www\./, "");
  const ld = jsonLdProduct();
  const offers: any[] = ld ? ([] as any[]).concat(ld.offers ?? []) : [];
  const offer = offers[0] ?? {};

  const name = (ld?.name as string | undefined)?.trim()
    || text("#productTitle") || text("h1.ui-pdp-title") || text("h1")
    || meta('meta[property="og:title"]');
  if (!name || name.length < 4) return null;

  let price = parsePrice(offer.price ?? offer.lowPrice ?? meta('meta[property="product:price:amount"]'));
  for (const sel of PRICE_SELECTORS[host] ?? []) {
    if (price) break;
    const el = document.querySelector(sel);
    price = parsePrice(el instanceof HTMLMetaElement ? el.content : el?.textContent);
  }
  const brand = typeof ld?.brand === "string" ? ld.brand : ld?.brand?.name;
  const gtin = ld?.gtin13 ?? ld?.gtin ?? ld?.gtin12 ?? ld?.gtin14;
  const image: unknown = ([] as unknown[]).concat(ld?.image ?? [])[0] ?? meta('meta[property="og:image"]');

  return {
    url: location.href.split("#")[0],
    title: document.title.slice(0, 300),
    productName: name.slice(0, 300),
    brand: brand?.slice(0, 120),
    sku: ld?.sku ? String(ld.sku).slice(0, 120) : undefined,
    gtin: gtin && /^\d{8,14}$/.test(String(gtin)) ? String(gtin) : undefined,
    price,
    currency: offer.priceCurrency ?? "BRL",
    image: typeof image === "string" && image.startsWith("http") ? image : undefined,
  };
}

/**
 * Cupom que a própria loja mostra no anúncio ("Aplicar cupom de 10%", "Cupom de R$ 20 OFF"): vale com certeza
 * para este produto. Só olha a área do produto (não carrosséis de outros itens).
 */
const COUPON_AREAS: Record<string, string[]> = {
  amazon: ["#promoPriceBlockMessage_feature_div", "#applicable_promotion_list_sec", "#vpcButton", "#couponBadge_feature_div",
    "#corePriceDisplay_desktop_feature_div", "#apex_desktop", "#buybox"],
  mercadolivre: [".ui-pdp-container__row--price", ".ui-pdp-promotions-pill", "[class*='coupon']", ".ui-pdp-price", ".ui-pdp-buybox"],
  shopee: ["[class*='voucher']", "section[aria-label*='cupom' i]"],
  magazineluiza: ["[data-testid*='coupon']", "[data-testid='price-value']"],
};
const COUPON_TEXT = [
  /aplicar cupom de\s*(\d{1,2}\s?%|R\$\s?[\d.,]+)/i,
  /economize\s*(\d{1,2}\s?%|R\$\s?[\d.,]+)\s*com (?:o )?cupom/i,
  /cupom de\s*(\d{1,2}\s?%|R\$\s?[\d.,]+)(?:\s*off)?/i,
  /(\d{1,2}\s?%|R\$\s?[\d.,]+)\s*off\s*(?:com|no|usando)\s*(?:o )?cupom/i,
];

export interface PageCoupon { amount: string; text: string; element: Element }

export function pageCoupon(): PageCoupon | null {
  const store = Object.keys(COUPON_AREAS).find((k) => location.hostname.replace(/\./g, "").includes(k));
  if (!store) return null;
  for (const sel of COUPON_AREAS[store]) {
    for (const el of document.querySelectorAll(sel)) {
      const t = (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
      for (const rx of COUPON_TEXT) {
        const m = t.match(rx);
        if (m) return { amount: m[1].replace(/\s/g, ""), text: m[0], element: el };
      }
    }
  }
  return null;
}
