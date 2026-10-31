/**
 * Fontes de notícias: RSS públicos dos portais (URL real + resumo) e Google News RSS (descobre mais veículos;
 * o link passa pelo Google). O texto da matéria é lido sob demanda, só das coberturas escolhidas para a análise.
 */
import { cacheGet, cacheSet } from "@cupons/db";
import { getText } from "./http";

export interface FeedItem { url: string; domain: string; site: string; title: string; description: string | null; publishedAt: string | null; viaGoogle: boolean }

/** Feeds abertos dos portais (testados em 30/10/2026). */
const FEEDS = [
  "https://g1.globo.com/rss/g1/",
  "https://oglobo.globo.com/rss/oglobo",
  "https://www.cnnbrasil.com.br/feed/",
  "https://feeds.bbci.co.uk/portuguese/rss.xml",
  "https://www.metropoles.com/feed",
  "https://www.poder360.com.br/feed/",
  "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
  "https://rss.uol.com.br/feed/noticias.xml",
];

const SITES: Record<string, string> = {
  "g1.globo.com": "g1", "oglobo.globo.com": "O Globo", "www.cnnbrasil.com.br": "CNN Brasil", "www.bbc.com": "BBC News Brasil",
  "www.metropoles.com": "Metrópoles", "www.poder360.com.br": "Poder360", "www1.folha.uol.com.br": "Folha", "www.folha.uol.com.br": "Folha",
  "noticias.uol.com.br": "UOL", "www.uol.com.br": "UOL", "www.estadao.com.br": "Estadão", "valor.globo.com": "Valor",
  "www.infomoney.com.br": "InfoMoney", "exame.com": "Exame", "veja.abril.com.br": "Veja", "www.cartacapital.com.br": "CartaCapital",
  "www.gazetadopovo.com.br": "Gazeta do Povo", "www.terra.com.br": "Terra", "noticias.r7.com": "R7", "www.band.uol.com.br": "Band",
  "www.correiobraziliense.com.br": "Correio Braziliense", "www.estadao.com.br/": "Estadão", "agenciabrasil.ebc.com.br": "Agência Brasil",
  "gauchazh.clicrbs.com.br": "GZH", "www.otempo.com.br": "O Tempo", "forbes.com.br": "Forbes Brasil", "istoe.com.br": "IstoÉ",
  "www.em.com.br": "Estado de Minas", "www.brasildefato.com.br": "Brasil de Fato", "jornalggn.com.br": "Jornal GGN",
  "revistaoeste.com": "Revista Oeste", "jovempan.com.br": "Jovem Pan", "www.oantagonista.com.br": "O Antagonista",
  "sbtnews.sbt.com.br": "SBT News", "www.nexojornal.com.br": "Nexo", "piaui.folha.uol.com.br": "piauí", "www.intercept.com.br": "Intercept Brasil",
  "www.dw.com": "DW Brasil", "www.opovo.com.br": "O Povo", "www.diariodepernambuco.com.br": "Diario de Pernambuco",
  "www.cnnbrasil.com.br/": "CNN Brasil", "www.moneytimes.com.br": "Money Times", "www.seudinheiro.com": "Seu Dinheiro",
  "www.brasil247.com": "Brasil 247", "www.poder360.com.br/": "Poder360", "www.jota.info": "JOTA", "www.conjur.com.br": "ConJur",
  "www.tecmundo.com.br": "TecMundo", "olhardigital.com.br": "Olhar Digital", "www.lance.com.br": "Lance!", "ge.globo.com": "ge",
};

/** Veículos conhecidos: aparecem antes de blogs e agregadores menores. */
export const MAJOR_DOMAINS = new Set(Object.keys(SITES));

export function domainOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}
export function siteOf(domain: string, fallback?: string | null): string {
  return SITES[domain] ?? fallback ?? domain.replace(/^www\d?\./, "");
}

const unescape = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const strip = (s: string) => unescape(unescape(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "";

async function cachedText(url: string, ttlSeconds: number): Promise<string> {
  const key = `news:${url}`;
  const hit = await cacheGet<string>(key);
  if (hit !== null) return hit;
  const text = await getText(url);
  await cacheSet(key, text, ttlSeconds);
  return text;
}

function parseDate(raw: string): string | null {
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function parseRss(xml: string, viaGoogle: boolean): FeedItem[] {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].flatMap(([item]) => {
    let link = strip(tag(item, "link")) || item.match(/<guid[^>]*>(https?:[^<]+)<\/guid>/)?.[1] || "";
    link = link.replace(/^https?:\/\/redir\.folha\.com\.br\/[^*]*\*/, ""); // Folha: redirecionador de clique
    let title = strip(tag(item, "title"));
    if (!link.startsWith("http") || title.length < 10) return [];
    let domain = domainOf(link);
    let site: string | null = null;
    if (viaGoogle) {
      // Google News: "Manchete - Veículo" e <source url="https://g1.globo.com">g1</source>
      const src = item.match(/<source url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/);
      domain = domainOf(src?.[1] ?? "");
      site = src ? strip(src[2]) : null;
      if (site) title = title.replace(new RegExp(`\\s+-\\s+${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
    }
    if (!domain) return [];
    const description = viaGoogle ? null : strip(tag(item, "description")).slice(0, 600) || null;
    return [{ url: link, domain, site: siteOf(domain, site), title, description, publishedAt: parseDate(tag(item, "pubDate") || tag(item, "dc:date")), viaGoogle }];
  });
}

/** Últimas matérias dos portais (cache de 10 min: um feed serve a todos os leitores). */
export async function portalFeeds(): Promise<{ items: FeedItem[]; errors: string[] }> {
  const settled = await Promise.allSettled(FEEDS.map((f) => cachedText(f, 600)));
  const items = settled.flatMap((s) => (s.status === "fulfilled" ? parseRss(s.value, false) : []));
  const errors = settled.flatMap((s, i) => (s.status === "rejected" ? [`${domainOf(FEEDS[i])}: ${String(s.reason).slice(0, 60)}`] : []));
  return { items, errors };
}

/** Google News: a mesma pauta em dezenas de veículos (o link é do Google; a manchete e o veículo são reais). */
export async function googleNews(query: string): Promise<FeedItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  return parseRss(await cachedText(url, 900), true);
}

/**
 * Bing Notícias: a mesma pauta com a URL REAL do veículo (vem no parâmetro url= do link de clique) e imagem.
 * Fonte principal de descoberta: com a URL real dá para ler o texto e montar a prévia (og:image).
 */
export async function bingNews(query: string): Promise<FeedItem[]> {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=pt-BR&cc=BR`;
  const xml = await cachedText(url, 900);
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].flatMap(([item]) => {
    const click = strip(tag(item, "link"));
    let real = click;
    try { real = new URL(click).searchParams.get("url") ?? click; } catch { return []; }
    const domain = domainOf(real);
    const title = strip(tag(item, "title"));
    if (!domain || !real.startsWith("http") || title.length < 10) return [];
    return [{
      url: real.split("#")[0], domain, site: siteOf(domain, strip(tag(item, "News:Source")) || null), title,
      description: strip(tag(item, "description")).slice(0, 600) || null, publishedAt: parseDate(tag(item, "pubDate")), viaGoogle: false,
    }];
  });
}

/** "Lula sanciona lei X; veja o que muda - g1" -> termos de busca sem o veículo e sem "veja o que muda". */
export function newsQuery(title: string): string {
  return title
    .replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, "")
    .replace(/[;:]\s*(veja|entenda|saiba|confira|assista)\b.*$/i, "")
    .replace(/["'“”‘’]/g, "")
    .split(/\s+/).slice(0, 14).join(" ");
}

const STOP = new Set(("a o os as de da do das dos e em no na nos nas um uma para por com sem que se ao à às pelo pela pelos pelas "
  + "é foi são ser tem têm mais menos sobre após entre até como seu sua seus suas diz dizem veja entenda saiba").split(" "));

/** Versão curta para a busca: números e palavras fortes ("Terceiro trimestre 2026 menor número desempregados período 2012"). */
export function newsKeywords(title: string): string {
  return newsQuery(title).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}%,.-]/gu, ""))
    .filter((w) => w && (/\d/.test(w) || (w.length > 3 && !STOP.has(w.toLowerCase())))).slice(0, 7).join(" ");
}

export interface ArticleMeta { text: string | null; image: string | null; description: string | null; title: string | null }

/** <meta property="og:image" content="..."> em qualquer ordem de atributos. */
function meta(html: string, name: string): string | null {
  const tagRx = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
  const m = html.match(tagRx)?.[0];
  const v = m?.match(/content=["']([^"']*)["']/i)?.[1];
  return v ? strip(v) : null;
}

/**
 * Prévia (og:image, og:title, og:description — como o WhatsApp) + começo da matéria:
 * articleBody do JSON-LD (muitos portais publicam), senão parágrafos do <article>, senão o og:description (paywall).
 */
export async function articleMeta(url: string): Promise<ArticleMeta | null> {
  const html = await cachedText(url, 6 * 3600).catch(() => null);
  if (!html) return null;
  const image = meta(html, "og:image") ?? meta(html, "twitter:image");
  const description = meta(html, "og:description") ?? meta(html, "description");
  const title = meta(html, "og:title");
  let text: string | null = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = m[1].match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
    if (body && body.length > 200) {
      try { text = strip(JSON.parse(`"${body}"`)).slice(0, 2500); break; } catch { /* JSON inválido: tenta o resto */ }
    }
  }
  if (!text) {
    const scope = html.match(/<article[\s\S]*?<\/article>/)?.[0] ?? html;
    const paragraphs = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => strip(p[1])).filter((p) => p.length > 60);
    text = paragraphs.join(" ").length > 300 ? paragraphs.join("\n").slice(0, 2500) : description;
  }
  return { text, image: image?.startsWith("http") ? image : null, description, title };
}
