/** Termos de desconto em texto livre (pt-BR) e cálculo determinístico do preço final. */

// Limites de palavra com Unicode: \b do JS não entende acentos
const B = "(?<![\\p{L}\\d])";
const E = "(?![\\p{L}\\d])";
const BRL = "R\\$\\s?(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{2})?|\\d+(?:,\\d{2})?)";

const PERCENT = /(\d{1,2}(?:[.,]\d)?)\s?%/u;
const FIXED = new RegExp(`(?:economize|ganhe|garanta)\\s+(?:até\\s+)?${BRL}|${BRL}\\s*(?:de\\s+desconto|off${E})`, "iu");
const CAP = new RegExp(
  `(?:m[áa]x(?:imo)?\\.?|desconto\\s+m[áa]ximo\\s+de|limitad[oa]\\s+a|limite\\s+de|no\\s+m[áa]ximo|\\(\\s*at[ée])\\s*(?:de\\s+)?${BRL}`, "iu");
const MIN = new RegExp(
  `(?:acima\\s+de|a\\s+partir\\s+de|m[íi]nim[ao]\\s+(?:de\\s+)?|(?:off|desconto)\\s+em\\s+(?:compras\\s+(?:acima\\s+)?de\\s+)?)\\s*${BRL}`, "iu");
const BRL_ALL = new RegExp(BRL, "gu");

// Público-alvo que não é eletrônico/tecnologia: cupom descartado sem gastar IA
const OFF_CATEGORY = new RegExp(
  `${B}(moda|cal[çc]ados?|roupas?|vestu[áa]rio|beleza|perfum\\p{L}*|maquiagem|supermercado|pet\\s?shop|ra[çc][ãa]o|` +
  `farm[áa]cia|livros?|brinquedos?|cama,?\\s+mesa|decora[çc][ãa]o|m[óo]veis|fitness|infantil|beb[êe]s?|joias|` +
  `rel[óo]gios?|alimentos|bebidas|vinhos?|mercearia|biscoitos?|chocolates?|cozinha|limpeza|colch[õo]es|sof[áa]s|` +
  `cuidados\\s+pessoais|lacta|tabletes?|coca-cola|hering|grendene|botas?|leve\\s+\\d+\\s+por)${E}`, "iu");

export type DiscountKind = "percent" | "fixed";
export interface Terms { kind: DiscountKind | null; value: number | null; cap: number | null; min: number | null }

export const brl = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Todos os valores escritos com "R$" no texto. */
export function brlAmounts(text: string): number[] {
  return [...(text ?? "").matchAll(BRL_ALL)].map((m) => brl(m[1]));
}

export function parseTerms(text: string): Terms {
  const t = text ?? "";
  const out: Terms = { kind: null, value: null, cap: null, min: null };
  const p = t.match(PERCENT);
  const f = p ? null : t.match(FIXED);
  if (p) Object.assign(out, { kind: "percent", value: Number(p[1].replace(",", ".")) });
  else if (f) Object.assign(out, { kind: "fixed", value: brl(f[1] ?? f[2]) });
  const c = t.match(CAP);
  if (c) out.cap = brl(c[1]);
  const m = t.match(MIN);
  if (m) out.min = brl(m[1]);
  return out;
}

export function offCategory(text: string): string | null {
  return (text ?? "").match(OFF_CATEGORY)?.[0] ?? null;
}

/** Preço com o cupom aplicado; null + motivo quando não se aplica. */
export function finalPrice(base: number, t: Pick<Terms, "kind" | "value" | "cap" | "min">): { price: number | null; why?: string } {
  if (!base) return { price: null, why: "sem preço base" };
  if (t.min && base < t.min) return { price: null, why: `compra mínima de R$ ${t.min.toFixed(2)}` };
  if (t.kind === "percent" && t.value) {
    if (t.value <= 0 || t.value > 70) return { price: null, why: "percentual implausível" };
    const discount = Math.min(base * t.value / 100, t.cap ?? Infinity);
    return { price: round2(base - discount) };
  }
  if (t.kind === "fixed" && t.value) {
    if (t.value >= base) return { price: null, why: "desconto maior que o preço" };
    return { price: round2(base - t.value) };
  }
  return { price: null, why: "desconto não identificado" };
}

/** "10% até R$200 mín R$149" — o % sozinho engana quando há teto. */
export function discountLabel(t: Terms): string | null {
  if (!t.kind || !t.value) return null;
  let label = t.kind === "percent" ? `${fmt(t.value)}%` : `R$ ${fmt(t.value)}`;
  if (t.cap && t.kind === "percent") label += ` até R$${fmt(t.cap)}`;
  if (t.min && t.min > 1) label += ` mín R$${fmt(t.min)}`;
  return label;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ","));
