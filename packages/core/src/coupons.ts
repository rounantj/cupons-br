/** Regras de cupom aprendidas no POC: o que é código, onde estão os termos, categoria, sinal dos comentários. */
import { offCategory, parseTerms, Terms } from "./pricing";

/** "Resgate no link", "cupom-amazon", "Santander": não são códigos digitáveis. */
export function isCode(code: string): boolean {
  if (!code || /\s|[/.]|^(direto|resgate|ative|link)/i.test(code) || /^[a-z]+(-[a-z]+)*$/.test(code)) return false;
  return /\d/.test(code) || code === code.toUpperCase();
}

// Categoria no NOME do código (CASA3010, BEBES3010, PET15). Só no nome: no texto "casa" seria ambíguo.
const CODE_CATEGORY = /^(casa|moda|pet|beleza|bebe|super(?:mercado)?|mercado|livro|esporte|infantil|kids|fashion|beauty|food|comida|farma)/i;

export function codeCategory(code: string): string | null {
  const letters = code.replace(/[^A-Za-z]+/g, " ").trim();
  return offCategory(letters) ?? letters.match(CODE_CATEGORY)?.[1] ?? null;
}

const CODE_LINE = /cupo[mn]|c[óo]digo|\b[A-Z0-9]{5,20}\b/;

/**
 * Termos do código: mesma linha; senão a anterior ("30% OFF limitado a R$500" / "CUPOM: X");
 * senão a seguinte, desde que não seja de outro cupom.
 */
export function termsNearCode(text: string, code: string, extra: string[] = []): Terms {
  const empty: Terms = { kind: null, value: null, cap: null, min: null };
  if (!code) return empty;
  const lc = code.toLowerCase();
  const lines = (text ?? "").split("\n").filter((l) => l.trim());
  const merge = (a: Terms, b: Terms): Terms => ({
    kind: a.kind ?? b.kind, value: a.value ?? b.value, cap: a.cap ?? b.cap, min: a.min ?? b.min,
  });
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].toLowerCase().includes(lc)) continue;
    let t = parseTerms(lines[i]);
    if (!t.kind && i > 0 && !lines[i - 1].toLowerCase().includes(lc)) t = merge(t, parseTerms(lines[i - 1]));
    if (!t.kind && i + 1 < lines.length && !CODE_LINE.test(lines[i + 1].replace(code, ""))) t = merge(t, parseTerms(lines[i + 1]));
    if (t.kind) return t;
  }
  const cited = extra.filter((x) => x.toLowerCase().includes(lc));
  return cited.length ? parseTerms(cited.join("\n")) : empty;
}

/** Linhas em volta do código (contexto para checar produto/modelo). */
export function linesNear(text: string, code: string, radius = 2): string[] {
  const lines = (text ?? "").split("\n");
  const idx = lines.flatMap((l, i) => (l.toLowerCase().includes(code.toLowerCase()) ? [i] : []));
  const keep = new Set(idx.flatMap((i) => range(Math.max(0, i - radius), Math.min(lines.length, i + radius + 1))));
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]);
}

const WORKS = /funcionou|funcionando|deu certo|consegui|aplicou|ainda (?:t[áa]|est[áa]) valendo|valeu/i;
const FAILS = /n[ãa]o (?:funciona|funcionou|deu|aplica|aplicou|vale)|inv[áa]lido|esgot|expir|acabou|encerrad/i;

/** Comentários que citam o código (ou todos, se não houver) com palavras de sucesso/falha. */
export function commentSignal(comments: string[], code: string | null): "works" | "fails" | "mixed" | null {
  let pool = comments.filter((c) => !c.startsWith("[CRIADOR]"));
  if (code) {
    const cited = pool.filter((c) => c.toLowerCase().includes(code.toLowerCase()));
    pool = cited.length ? cited : pool;
  }
  const works = pool.filter((c) => WORKS.test(c) && !FAILS.test(c)).length;
  const fails = pool.filter((c) => FAILS.test(c)).length;
  if (works && fails) return "mixed";
  return works ? "works" : fails ? "fails" : null;
}

/** Confiança mínima para mostrar um cupom: abaixo disso ele "talvez sirva" e frustra o usuário no checkout. */
export const MIN_CONFIDENCE = 0.6;

const STORE_WORDS = /^(mercado|amazon|shopee|magalu|magazine|kabum|casas|americanas|compras|r\$)/i;

/**
 * Escopo escrito no cupom de loja: "em itens Auto", "em Itens de Limpeza", "em Pet Shop", "35% OFF em itens Colgate".
 * Retorna a categoria/marca (em minúsculas) ou null quando o texto não restringe.
 */
export function scopeFromText(text: string): string | null {
  const m = text.match(/\b(?:em|nos|nas)\s+(?:itens|produtos|categoria)\s+(?:de\s+|da\s+|do\s+)?([A-Za-zÀ-ú][A-Za-zÀ-ú&\s]{1,30}?)(?=\s*(?:[,.|;:!()\-–—]|\.\.|\bacima\b|\ba partir\b|\bcom\b|\bno\b|\bna\b|\d|$))/im)
    ?? text.match(/\bem\s+((?:[A-ZÀ-Ú][a-zà-ú]+)(?:\s+(?:e\s+)?[A-ZÀ-Ú][a-zà-ú]+)*)/m);
  const scope = m?.[1]?.trim();
  if (!scope || STORE_WORDS.test(scope) || SELECTED.test(scope)) return null;
  return scope.toLowerCase();
}

/**
 * Código com data de campanha ("TODOSITE2810", "SITE3010") expira depois desse dia: no teste real,
 * TODOSITE2810 respondeu "O cupom não está mais disponível" em 30/10.
 */
export function expiredByCode(code: string, now = new Date()): boolean {
  const m = code.match(/(?<!\d)(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(?!\d)/);
  if (!m) return false;
  const [day, month] = [Number(m[1]), Number(m[2])];
  let end = new Date(now.getFullYear(), month - 1, day, 23, 59, 59);
  if (end.getTime() - now.getTime() > 180 * 86400_000) end = new Date(now.getFullYear() - 1, month - 1, day, 23, 59, 59); // virada do ano
  return end < now;
}

const PHONE = /\b(iphone|smartphone|celular|galaxy [asmz]\d|moto [eg]\d|motorola|redmi|xiaomi|poco [xmf]\d)/i;
const GENERIC_TECH = /eletr[ôo]nic|tecnolog|inform[áa]tica|[áa]udio|v[íi]deo|games?\b|eletrodom|eletroport/i;

/**
 * Regras fixas de categoria (a IA oscilou: "iPhone 17 está em eletrônicos?" deu true e false no mesmo dia).
 * No Mercado Livre/Amazon "Celulares e Telefones" é categoria própria: cupom de "Eletrônicos" não aplicou num iPhone.
 * Retorna null quando a regra não decide (a IA responde).
 */
export function categoryRule(productName: string, category: string): boolean | null {
  if (PHONE.test(productName)) return /celular|smartphone|telefon|iphone|apple/i.test(category) ? null : GENERIC_TECH.test(category) ? false : null;
  return null;
}

export const SELECTED = /selecionad|eleg[íi]ve|participantes|da campanha|lojas? oficia|qualificad|itens da lista|leve \d+ (?:itens|produtos|unidades)|sele[çc][ãa]o de|outlet|perto do vencimento/i;
const GENERIC = new Set(["produtos", "produto", "itens", "item", "selecionados", "selecionadas", "participantes", "campanha",
  "lista", "loja", "site", "todo", "toda", "todos", "todas", "utilizado", "utilize", "valido", "limitado", "acima",
  "compras", "compra", "cupom", "desconto", "carrinho", "pedido", "pedidos", "liberado", "categoria", "categorias",
  "geral", "qualquer", "mercado", "livre", "amazon", "magalu", "magazine", "luiza", "kabum", "shopee", "americanas"]);

/**
 * Restrição de categoria citada pela IA, aceita só se as palavras existem no texto.
 * "" = site todo; "?" = a IA citou algo que não está no texto (não aplicar por segurança).
 */
export function verifiedRestriction(restricted: string | null | undefined, sourceText: string): string {
  const r = (restricted ?? "").trim().toLowerCase();
  const words = (s: string) => new Set(s.normalize("NFD").replace(/\p{M}/gu, "").match(/[a-z0-9]{4,}/gi)?.map((w) => w.toLowerCase()) ?? []);
  const meaningful = [...words(r)].filter((w) => !GENERIC.has(w));
  if (!meaningful.length || /\d+\s*%|r\$/.test(r)) return "";
  const text = words(sourceText);
  return meaningful.some((w) => text.has(w)) ? r : "?";
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
