/** Identidade do produto: normalização do nome e checagens "é o mesmo produto/modelo?". */

const STOP = new Set(["de", "da", "do", "com", "para", "polegadas", "pol", "novo", "nova", "original", "o", "a", "e"]);
/** Qualificadores que separam modelos (PS5 Pro x Slim, iPhone Pro x Max...) */
const QUALIFIERS = new Set(["pro", "slim", "digital", "lite", "mini", "max", "plus", "ultra", "edge", "fe"]);

export function normalizeText(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/play\s*station/g, "playstation")
    .replace(/\bps(\d)\b/g, "playstation $1")
    .replace(/(\d+)\s*(gb|tb|mb|pol|polegadas|"|”)/g, "$1 $2"); // "256GB" = "256 gb"
}

/** Chave para achar o mesmo produto por nome: tokens normalizados, sem stopwords, ordenados. */
export function canonicalKey(name: string): string {
  const tokens = normalizeText(name).match(/[a-z0-9]+/g) ?? [];
  return [...new Set(tokens.filter((t) => !STOP.has(t)))].sort().join(" ");
}

function qualifiers(text: string): Set<string> {
  return new Set((normalizeText(text).match(/[a-z]+/g) ?? []).filter((w) => QUALIFIERS.has(w)));
}

/**
 * O trecho cita o produto? Todos os números do nome (17, 18, 75...) e ao menos uma palavra dele.
 * "17e" ou "17pro" é outro modelo (número colado em letra não conta).
 */
export function productMismatch(query: string, context: string): string | null {
  const q = normalizeText(query);
  const ctx = normalizeText(context);
  const tokens = (q.match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t));
  const numbers = tokens.filter((t) => /^\d+$/.test(t));
  const words = tokens.filter((t) => !/^\d+$/.test(t) && t.length > 2);
  const missing = numbers.filter((n) => !new RegExp(`(?<!\\d)${n}(?![\\da-z])`).test(ctx));
  if (missing.length) return `trecho não cita ${missing.join(", ")}`;
  if (words.length && !words.some((w) => ctx.includes(w))) return "trecho não cita o produto";
  return null;
}

/**
 * Cupom de OUTRO modelo? Só vale checar quando o trecho fala do produto (mesma linha/número):
 * cupom geral ("10% no site todo") não cita produto nenhum e não pode ser rejeitado por "falta Pro".
 */
export function couponForOtherModel(query: string, context: string): string | null {
  // família do produto (sem capacidade: "iPhone 17 Pro Max" fala da família de "iPhone 17 Pro 256GB")
  const family = normalizeText(query).replace(/\b\d+\s*(gb|tb|mb)\b/g, " ");
  if (productMismatch(family, context)) return null; // trecho não é sobre este produto: cupom geral
  return modelConflict(query, context);
}

/** Dois nomes descrevem o mesmo produto? Mesmos números de modelo/capacidade e nenhuma versão diferente. */
export function sameProduct(a: string, b: string): boolean {
  return !productMismatch(a, b) && !productMismatch(b, a) && !modelConflict(a, b) && !modelConflict(b, a);
}

/** Busca "ps5 pro" e o trecho fala de "ps5 slim" -> conflito. Busca base aceita Slim/Digital, não Pro/Max/Ultra. */
export function modelConflict(query: string, context: string): string | null {
  const q = qualifiers(query);
  const ctx = qualifiers(context);
  const missing = [...q].filter((x) => !ctx.has(x));
  let extra = [...ctx].filter((x) => !q.has(x));
  if (!q.size) extra = extra.filter((x) => x !== "slim" && x !== "digital");
  if (missing.length || extra.length) return `modelo diferente (${extra.join(", ") || "sem " + missing.join(", ")})`;
  return null;
}
