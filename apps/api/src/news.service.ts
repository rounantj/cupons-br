import { Injectable } from "@nestjs/common";
import { CreateNewsLookup, NewsAnalysisView, NewsLookupView, NewsSourceView, NewsStatus } from "@cupons/contracts";
import { getQueue, one, query, QUEUES } from "@cupons/db";
import { domainOf, siteOf } from "@cupons/sources";

/** Análise pronta mais nova que isto é reaproveitada (notícia evolui: depois disso, refaz). */
const FRESH_MINUTES = Number(process.env.NEWS_FRESH_MINUTES ?? 120);

interface Row {
  id: string; url: string; domain: string; site: string; title: string; description: string | null; image: string | null;
  published_at: string | null; via_google: boolean; body: string | null;
}

@Injectable()
export class NewsService {
  async create({ page }: CreateNewsLookup): Promise<NewsLookupView> {
    const domain = domainOf(page.url);
    const published = page.publishedAt && Number.isFinite(Date.parse(page.publishedAt)) ? new Date(page.publishedAt).toISOString() : null;
    const article = await one<{ id: string }>(
      `INSERT INTO news_articles (url, domain, site, title, description, body, published_at, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, description = coalesce(EXCLUDED.description, news_articles.description),
         image = coalesce(EXCLUDED.image, news_articles.image),
         body = coalesce(EXCLUDED.body, news_articles.body), published_at = coalesce(news_articles.published_at, EXCLUDED.published_at),
         via_google = false
       RETURNING id`,
      [page.url.split("#")[0], domain, siteOf(domain, page.siteName), page.title, page.description ?? null, page.text?.slice(0, 6000) ?? null, published, page.image ?? null]);

    // mesma matéria: análise recente ou em andamento serve para todos os leitores
    const recent = await one<{ id: string }>(
      `SELECT id FROM news_lookups WHERE article_id = $1 AND (
         (status = 'done' AND finished_at > now() - make_interval(mins => $2))
         OR (status IN ('queued', 'collecting', 'analyzing') AND created_at > now() - interval '5 minutes'))
       ORDER BY created_at DESC LIMIT 1`, [article!.id, FRESH_MINUTES]);
    if (recent) return (await this.view(recent.id))!;

    const lookup = await one<{ id: string }>("INSERT INTO news_lookups (article_id) VALUES ($1) RETURNING id", [article!.id]);
    await (await getQueue()).send(QUEUES.newsCollect, { lookupId: lookup!.id }, { retryLimit: 1, retryDelay: 5 });
    return (await this.view(lookup!.id))!;
  }

  async view(id: string): Promise<NewsLookupView | null> {
    const l = await one<{ id: string; article_id: string; status: NewsStatus; kind: string | null; niche: string | null; related: { id: string; similarity: number }[]; analysis: any; created_at: string; finished_at: string | null }>(
      "SELECT id, article_id, status, kind, niche, related, analysis, created_at, finished_at FROM news_lookups WHERE id = $1", [id]);
    if (!l) return null;
    const ids = [l.article_id, ...l.related.map((r) => r.id)];
    const rows = new Map((await query<Row>(
      "SELECT id, url, domain, site, title, description, image, published_at, via_google, body FROM news_articles WHERE id = ANY($1)", [ids])).map((r) => [r.id, r]));
    const sim = new Map(l.related.map((r) => [r.id, r.similarity]));
    const toView = (articleId: string, ref: number): NewsSourceView | null => {
      const r = rows.get(articleId);
      return r ? {
        ref, site: r.site, domain: r.domain, title: r.title, url: r.url, image: r.image, description: r.description,
        publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
        viaGoogle: r.via_google, headlineOnly: !r.body, similarity: ref === 0 ? 1 : sim.get(articleId) ?? 0,
      } : null;
    };
    const related = l.related.map((r, i) => toView(r.id, i + 1)).filter((v): v is NewsSourceView => Boolean(v));
    const refOf = new Map([[l.article_id, 0], ...related.map((v, i) => [l.related[i].id, v.ref] as [string, number])]);
    const siteOfId = (articleId: string) => rows.get(articleId)?.site ?? "?";

    let analysis: NewsAnalysisView | null = null;
    if (l.analysis) {
      const a = l.analysis;
      analysis = {
        summary: a.summary, consensus: a.consensus, missing: a.missing, balance: a.balance,
        sources: a.sources.filter((s: any) => refOf.has(s.articleId)).map((s: any) => ({
          ref: refOf.get(s.articleId)!, site: siteOfId(s.articleId), tone: s.tone, framing: s.framing, emphasis: s.emphasis,
          voices: s.voices, loadedWords: s.loadedWords, evidence: s.evidence,
        })).sort((x: any, y: any) => x.ref - y.ref),
        divergences: a.divergences.map((d: any) => ({
          topic: d.topic,
          positions: d.positions.filter((p: any) => refOf.has(p.articleId)).map((p: any) => ({ ref: refOf.get(p.articleId)!, site: siteOfId(p.articleId), says: p.says })),
        })).filter((d: any) => d.positions.length >= 2),
      };
    }
    return {
      id: l.id, status: l.status, kind: l.kind, niche: l.niche, article: toView(l.article_id, 0), related, analysis,
      createdAt: new Date(l.created_at).toISOString(), finishedAt: l.finished_at ? new Date(l.finished_at).toISOString() : null,
    };
  }
}
