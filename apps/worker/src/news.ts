/**
 * Segunda extensão (notícias), filas próprias:
 *  news.collect: feeds dos portais + Google News -> vetor do título -> mesma história (vizinhos no pgvector, janela de dias)
 *  news.analyze: começo de cada matéria -> IA compara a cobertura -> o código confere as evidências citadas
 */
import { chatJson, CLASSIFY_SCHEMA, CLASSIFY_SYSTEM, embed, NEWS_SCHEMA, NEWS_SYSTEM, NewsAnalysisRaw, PageClass } from "@cupons/ai";
import { getQueue, one, query, QUEUES, toVector, NewsJob } from "@cupons/db";
import { articleMeta, bingNews, FeedItem, googleNews, newsKeywords, newsQuery, portalFeeds } from "@cupons/sources";

/** Similaridade mínima de cosseno entre títulos para ser candidata (a IA ainda confirma "mesma história"). */
const MIN_SIMILARITY = Number(process.env.NEWS_MIN_SIMILARITY ?? 0.55);
const MAX_RELATED = 8;
/** "não menciona", "só a manchete": omissão não é posição numa divergência. */
const OMISSION = /^(n[ãa]o (menciona|traz|cita|informa|destaca|detalha|apresenta)|s[óo] (a )?manchete|sem (detalhes|mencionar)|texto (curto|incompleto))/i;
const SYNDICATION = /(^|\.)(msn\.com|yahoo\.com|newsbreak\.com|flipboard\.com)$/;
const NEWS_MODEL = () => process.env.NEWS_MODEL || "gpt-5-mini";

interface Article {
  id: string; url: string; domain: string; site: string; title: string; description: string | null; body: string | null;
  published_at: Date | null; via_google: boolean; has_embedding: boolean; image: string | null;
}

const ARTICLE_COLS = "id, url, domain, site, title, description, body, published_at, via_google, image, embedding IS NOT NULL AS has_embedding";
const embedText = (a: { title: string; description: string | null }) => `${a.title}\n${a.description ?? ""}`.slice(0, 1200);

async function setStatus(lookupId: string, status: string, extra = "") {
  await query(`UPDATE news_lookups SET status = $2${extra} WHERE id = $1`, [lookupId, status]);
}

/** Guarda as matérias dos feeds e do Google News; só as novas pagam embedding. */
async function index(items: FeedItem[]): Promise<number> {
  if (!items.length) return 0;
  await query(
    `INSERT INTO news_articles (url, domain, site, title, description, published_at, via_google)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::boolean[])
     ON CONFLICT (url) DO NOTHING`,
    [items.map((i) => i.url), items.map((i) => i.domain), items.map((i) => i.site), items.map((i) => i.title),
      items.map((i) => i.description), items.map((i) => i.publishedAt), items.map((i) => i.viaGoogle)]);
  const pending = await query<{ id: string; title: string; description: string | null }>(
    "SELECT id, title, description FROM news_articles WHERE url = ANY($1) AND embedding IS NULL", [items.map((i) => i.url)]);
  for (let i = 0; i < pending.length; i += 100) {
    const chunk = pending.slice(i, i + 100);
    const vectors = await embed(chunk.map(embedText));
    await query(
      `UPDATE news_articles a SET embedding = v.e::vector FROM unnest($1::uuid[], $2::text[]) AS v(id, e) WHERE a.id = v.id`,
      [chunk.map((c) => c.id), vectors.map(toVector)]);
  }
  return pending.length;
}

export async function handleNewsCollect({ lookupId }: NewsJob) {
  const orig = await one<Article>(
    `SELECT ${ARTICLE_COLS} FROM news_articles WHERE id = (SELECT article_id FROM news_lookups WHERE id = $1)`, [lookupId]);
  if (!orig) throw new Error(`lookup ${lookupId} sem matéria`);
  await setStatus(lookupId, "collecting");
  if (!orig.has_embedding) {
    const [v] = await embed([embedText(orig)]);
    await query("UPDATE news_articles SET embedding = $1 WHERE id = $2", [toVector(v), orig.id]);
  }

  // a IA classifica tipo/nicho e escreve a busca; sem IA (erro), a heurística do título
  const cls = await chatJson<PageClass>(CLASSIFY_SYSTEM,
    `veículo: ${orig.site}\ntítulo: ${orig.title}\ndescrição: ${orig.description ?? ""}\ntrecho: ${(orig.body ?? "").slice(0, 600)}`, CLASSIFY_SCHEMA)
    .then((r) => r.data).catch((e) => { console.error("classify:", (e as Error).message); return null; });
  await query("UPDATE news_lookups SET kind = $2, niche = $3 WHERE id = $1", [lookupId, cls?.kind ?? null, cls?.niche ?? null]);

  // Bing (URL real + imagem) é a descoberta principal; Google News amplia os veículos (só manchete); feeds = portais grandes
  const q = newsQuery(orig.title);
  const soft = (name: string) => (e: unknown) => { console.error(`${name}:`, (e as Error).message); return [] as FeedItem[]; };
  const kw = cls?.query?.trim() || newsKeywords(orig.title);
  const [feeds, bingTitle, bingKw, google] = await Promise.all([portalFeeds(), bingNews(q).catch(soft("bing")),
    kw && kw !== q ? bingNews(kw).catch(soft("bing")) : Promise.resolve([] as FeedItem[]), googleNews(q).catch(soft("google news"))]);
  const bing = [...bingTitle, ...bingKw];
  const fresh = await index([...feeds.items, ...bing, ...google]);

  // vizinhos no vetor, de outros veículos, publicados perto da matéria original
  const rows = await query<{ id: string; domain: string; via_google: boolean; similarity: number; title: string; site: string }>(
    `WITH o AS (SELECT embedding, coalesce(published_at, now()) AS at FROM news_articles WHERE id = $1)
     SELECT a.id, a.domain, a.via_google, a.title, a.site, 1 - (a.embedding <=> o.embedding) AS similarity
     FROM news_articles a, o
     WHERE a.id <> $1 AND a.domain <> $2 AND a.embedding IS NOT NULL
       AND a.published_at BETWEEN o.at - interval '4 days' AND o.at + interval '3 days'
     ORDER BY a.embedding <=> o.embedding LIMIT 80`, [orig.id, orig.domain]);
  // peso de relevância de cada fonte (registro por nicho); fora do registro = peso baixo
  const sources = new Map((await query<{ domain: string; weight: number; niches: string[] }>(
    "SELECT domain, weight, niches FROM content_sources WHERE domain = ANY($1)", [[...new Set(rows.map((r) => r.domain))]])).map((s) => [s.domain, s]));
  // um por veículo: a mais parecida; com URL direta vale mais que a do Google; peso e nicho da fonte somam
  const best = new Map<string, { id: string; similarity: number; score: number; major: boolean }>();
  const origTitle = norm(orig.title);
  for (const r of rows) {
    if (r.similarity < MIN_SIMILARITY) continue;
    // republicação da própria matéria (MSN, Yahoo, "g1 on MSN"): mesma manchete não é outra cobertura
    if (SYNDICATION.test(r.domain) || / on msn$/i.test(r.site) || norm(r.title) === origTitle) continue;
    const src = sources.get(r.domain);
    const weight = src?.weight ?? 0.1;
    const nicheBonus = cls && src?.niches.includes(cls.niche) ? 0.05 : 0;
    // com URL real tem texto e prévia: vence a versão do Google do mesmo veículo se for quase tão parecida
    const score = r.similarity - (r.via_google ? 0.1 : 0) + 0.15 * weight + nicheBonus;
    const cur = best.get(r.domain);
    if (!cur || score > cur.score) best.set(r.domain, { id: r.id, similarity: Math.round(r.similarity * 1000) / 1000, score, major: weight >= 0.5 });
  }
  // veículos conhecidos primeiro; blogs e portais pequenos só completam a lista
  const ranked = [...best.values()].sort((a, b) => Number(b.major) - Number(a.major) || b.score - a.score);
  const majors = ranked.filter((r) => r.major).length;
  const related = ranked.slice(0, majors >= 4 ? Math.min(majors, MAX_RELATED) : MAX_RELATED).map(({ id, similarity }) => ({ id, similarity }));
  console.log(`news.collect ${lookupId}: ${feeds.items.length} dos feeds + ${bing.length} do Bing + ${google.length} do Google (${fresh} novas), ${related.length} coberturas`
    + (feeds.errors.length ? ` · feeds com erro: ${feeds.errors.join("; ")}` : ""));

  if (!related.length) {
    await setStatus(lookupId, "done", ", related = '[]', finished_at = now()");
    return;
  }
  // prévia de link (og:image/título/descrição) + começo do texto: a extensão mostra os cards antes da análise
  const toRead = await query<{ id: string; url: string }>(
    "SELECT id, url FROM news_articles WHERE id = ANY($1) AND via_google = false AND (body IS NULL OR image IS NULL)",
    [[orig.id, ...related.map((r) => r.id)]]);
  await Promise.all(toRead.map(async (a) => {
    const m = await articleMeta(a.url);
    if (m) await query("UPDATE news_articles SET body = coalesce(body, $2), image = coalesce(image, $3), description = coalesce(description, $4) WHERE id = $1",
      [a.id, m.text, m.image, m.description]);
  }));
  await query("UPDATE news_lookups SET status = 'analyzing', related = $2 WHERE id = $1", [lookupId, JSON.stringify(related)]);
  await (await getQueue()).send(QUEUES.newsAnalyze, { lookupId }, { retryLimit: 1, retryDelay: 5 });
}

function norm(s: string): string { return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/["'“”‘’«»]/g, "").replace(/\s+/g, " ").trim(); }

export async function handleNewsAnalyze({ lookupId }: NewsJob) {
  const lookup = await one<{ article_id: string; related: { id: string; similarity: number }[] }>(
    "SELECT article_id, related FROM news_lookups WHERE id = $1", [lookupId]);
  if (!lookup) return;
  const ids = [lookup.article_id, ...lookup.related.map((r) => r.id)];
  const byId = new Map((await query<Article>(`SELECT ${ARTICLE_COLS} FROM news_articles WHERE id = ANY($1)`, [ids])).map((a) => [a.id, a]));
  const articles = ids.map((id) => byId.get(id)).filter((a): a is Article => Boolean(a));

  // (o texto das coberturas com URL direta foi lido na coleta; as do Google ficam só com a manchete)
  const textOf = (a: Article) => [a.title, a.body ?? a.description ?? ""].join("\n");
  const prompt = articles.map((a, ref) => {
    const when = a.published_at ? new Date(a.published_at).toISOString().slice(0, 16).replace("T", " ") : "sem data";
    const head = `[${ref}] ${ref === 0 ? "ORIGINAL · " : ""}${a.site} · ${when}`;
    const body = (a.body ?? a.description ?? "").slice(0, ref === 0 ? 3500 : 1800);
    return `${head}\nmanchete: ${a.title}\n${body ? `texto: ${body}` : "(só a manchete)"}\n`;
  }).join("\n");
  const { data } = await chatJson<NewsAnalysisRaw>(NEWS_SYSTEM, prompt, NEWS_SCHEMA, { model: NEWS_MODEL(), reasoningEffort: "low" });

  // a IA compara; o código confere: evidência precisa existir no texto daquele veículo
  const sources = data.sources.filter((s) => s.ref >= 0 && s.ref < articles.length).map((s) => {
    const ok = s.evidence && norm(textOf(articles[s.ref])).includes(norm(s.evidence));
    return { ...s, evidence: ok ? s.evidence : null };
  });
  const offTopic = new Set(sources.filter((s) => s.ref > 0 && !s.sameStory).map((s) => s.ref));
  const keepRelated = lookup.related.filter((_, i) => !offTopic.has(i + 1));
  const analysis = {
    ...data,
    // refs passam a apontar para ids estáveis (a lista de coberturas pode encolher)
    sources: sources.filter((s) => !offTopic.has(s.ref)).map((s) => ({ ...s, articleId: articles[s.ref].id })),
    divergences: data.divergences.map((d) => ({
      topic: d.topic,
      positions: d.positions.filter((p) => p.ref >= 0 && p.ref < articles.length && !offTopic.has(p.ref) && !OMISSION.test(p.says))
        .map((p) => ({ ...p, articleId: articles[p.ref].id })),
    })).filter((d) => d.positions.length >= 2).slice(0, 4),
  };
  await query("UPDATE news_lookups SET status = 'done', related = $2, analysis = $3, finished_at = now() WHERE id = $1",
    [lookupId, JSON.stringify(keepRelated), JSON.stringify(analysis)]);
  console.log(`news.analyze ${lookupId}: ${articles.length} matérias, ${offTopic.size} fora do assunto, ${sources.filter((s) => s.evidence).length} evidências conferidas`);
}
