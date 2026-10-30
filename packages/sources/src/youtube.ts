/**
 * YouTube Data API v3: vídeos recentes (encerrados ou não) de influenciadores que citam cupom/preço do produto.
 * Cota grátis: 10.000 unid./dia. search custa 100; videos/commentThreads/playlistItems/channels custam 1.
 * Por isso: poucas buscas (com cache) + monitoramento barato dos canais que já acertaram cupom.
 * A fala do vídeo não é acessível pela API oficial: usamos título, descrição e comentários.
 */
import { cacheGet, cacheSet, one, query } from "@cupons/db";
import { politeFetch } from "./http";
import { CreatorContent, SourceResult, SPANISH } from "./types";

const API = "https://www.googleapis.com/youtube/v3";
const COST: Record<string, number> = { search: 100, videos: 1, commentThreads: 1, playlistItems: 1, channels: 1 };
const CACHE_SECONDS: Record<string, number> = { search: 3 * 3600, videos: 3600, commentThreads: 3600, playlistItems: 3600, channels: 7 * 86400 };
const RECENT_DAYS = 30;
const WATCHLIST = 15;
const COUPON_WORD = /cupo[mn]|c[óo]digo|R\$\s?\d|\b\d{1,2}\s?%|\boff\b/i;

export const youtubeEnabled = () => Boolean(process.env.YOUTUBE_API_KEY);
const dailyQuota = () => Number(process.env.YOUTUBE_DAILY_QUOTA ?? 9000);

export async function quotaUsedToday(): Promise<number> {
  return (await one<{ units: number }>("SELECT units FROM youtube_quota WHERE day = current_date"))?.units ?? 0;
}

const stats = { units: 0, hits: 0 };

async function call(endpoint: string, params: Record<string, string | number>): Promise<any> {
  const key = `yt:${endpoint}:${JSON.stringify(Object.entries(params).sort())}`; // a chave da API não entra no cache
  const hit = await cacheGet(key);
  if (hit) { stats.hits++; return hit; }
  if ((await quotaUsedToday()) + COST[endpoint] > dailyQuota()) throw new Error(`cota diária do YouTube (${dailyQuota()}) atingida`);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), key: process.env.YOUTUBE_API_KEY! });
  const r = await politeFetch(`${API}/${endpoint}?${qs}`);
  if (!r.ok) throw new Error(`YouTube ${endpoint} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const body = await r.json();
  await query(`INSERT INTO youtube_quota (day, units) VALUES (current_date, $1)
               ON CONFLICT (day) DO UPDATE SET units = youtube_quota.units + EXCLUDED.units`, [COST[endpoint]]);
  await cacheSet(key, body, CACHE_SECONDS[endpoint]);
  stats.units += COST[endpoint];
  return body;
}

async function search(q: string, order: "date" | "relevance"): Promise<string[]> {
  // data arredondada ao dia: senão a chave do cache muda a cada segundo e a cota é gasta de novo
  const after = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString().slice(0, 10) + "T00:00:00Z";
  const body = await call("search", { part: "snippet", q, type: "video", regionCode: "BR", relevanceLanguage: "pt", maxResults: 25, publishedAfter: after, order });
  return (body.items ?? []).map((i: any) => i.id.videoId);
}

async function watchlistVideos(queryWords: string[]): Promise<string[]> {
  const channels = await query<{ channel_id: string; uploads_playlist: string | null }>(
    `SELECT channel_id, uploads_playlist FROM youtube_channels WHERE coupon_hits > 0
     ORDER BY coupon_hits DESC, last_hit_at DESC NULLS LAST LIMIT $1`, [WATCHLIST]);
  const cutoff = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString();
  const ids: string[] = [];
  for (const ch of channels) {
    let playlist = ch.uploads_playlist;
    if (!playlist) {
      const item = (await call("channels", { part: "contentDetails", id: ch.channel_id })).items?.[0];
      playlist = item?.contentDetails?.relatedPlaylists?.uploads ?? null;
      if (!playlist) continue;
      await query("UPDATE youtube_channels SET uploads_playlist = $1 WHERE channel_id = $2", [playlist, ch.channel_id]);
    }
    for (const it of (await call("playlistItems", { part: "snippet", playlistId: playlist!, maxResults: 15 })).items ?? []) {
      const text = `${it.snippet.title} ${it.snippet.description}`.toLowerCase();
      if (it.snippet.publishedAt >= cutoff && (queryWords.some((w) => text.includes(w)) || COUPON_WORD.test(text)))
        ids.push(it.snippet.resourceId.videoId);
    }
  }
  return ids;
}

function relevantLines(text: string, radius = 2): string {
  const lines = text.split("\n").filter((l) => l.trim());
  const keep = new Set<number>();
  lines.forEach((l, i) => { if (COUPON_WORD.test(l)) for (let j = Math.max(0, i - radius); j <= Math.min(lines.length - 1, i + radius); j++) keep.add(j); });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join("\n").slice(0, 1500);
}

async function comments(videoId: string, channelId: string): Promise<string[]> {
  let body: any;
  try {
    body = await call("commentThreads", { part: "snippet", videoId, order: "relevance", maxResults: 20, textFormat: "plainText" });
  } catch {
    return []; // comentários desativados
  }
  return (body.items ?? [])
    .map((t: any) => t.snippet.topLevelComment.snippet)
    .map((c: any) => ({ text: String(c.textDisplay).slice(0, 220), likes: c.likeCount ?? 0, byCreator: c.authorChannelId?.value === channelId }))
    .sort((a: any, b: any) => Number(b.byCreator) - Number(a.byCreator) || b.likes - a.likes)
    .map((c: any) => (c.byCreator ? `[CRIADOR] ${c.text}` : c.text));
}

export async function collectYoutube(productName: string): Promise<SourceResult> {
  stats.units = 0; stats.hits = 0;
  const words = productName.toLowerCase().match(/\w{3,}/g) ?? [];
  const discovered = new Set([
    ...(await search(`${productName} cupom`, "date")),
    ...(await search(`${productName} cupom de desconto`, "relevance")),
    ...(await search(`${productName} promoção`, "date")),
  ]);
  const watched = (await watchlistVideos(words)).filter((id) => !discovered.has(id));
  const ids = [...discovered, ...watched].slice(0, 60);
  const videos: any[] = [];
  for (let i = 0; i < ids.length; i += 50) videos.push(...((await call("videos", { part: "snippet", id: ids.slice(i, i + 50).join(",") })).items ?? []));

  const items: CreatorContent[] = [];
  for (const v of videos) {
    const sn = v.snippet;
    const lang = (sn.defaultAudioLanguage ?? sn.defaultLanguage ?? "").toLowerCase();
    if (lang.startsWith("es") || (!lang.startsWith("pt") && SPANISH.test(`${sn.title}\n${sn.description}`))) continue;
    const text = relevantLines(sn.description ?? "");
    const cmts = text || COUPON_WORD.test(sn.title) ? await comments(v.id, sn.channelId) : [];
    if (!text && !cmts.some((c) => COUPON_WORD.test(c))) continue;
    await query(`INSERT INTO youtube_channels (channel_id, title, videos_seen) VALUES ($1, $2, 1)
                 ON CONFLICT (channel_id) DO UPDATE SET videos_seen = youtube_channels.videos_seen + 1, title = EXCLUDED.title`,
      [sn.channelId, sn.channelTitle]);
    items.push({
      source: "youtube", sourceUrl: `https://www.youtube.com/watch?v=${v.id}`, title: sn.title, creator: sn.channelTitle,
      creatorId: `yt:${sn.channelId}`, text, comments: cmts.slice(0, 15), publishedAt: sn.publishedAt, live: sn.liveBroadcastContent === "live",
    });
  }
  return {
    items,
    detail: `${discovered.size} vídeos na descoberta, ${watched.length} da lista de canais, ${items.length} com cupom/preço · ` +
      `cota ${stats.units} (cache ${stats.hits}x) · hoje ${await quotaUsedToday()}/${dailyQuota()}`,
  };
}

/** Descrições de vídeos já coletados: links t.me alimentam a descoberta de canais do Telegram. */
export async function recentYoutubeDescriptions(): Promise<{ channel: string; description: string }[]> {
  const rows = await query<{ value: any }>("SELECT value FROM cache WHERE key LIKE 'yt:videos:%' AND expires_at > now()");
  return rows.flatMap((r) => (r.value.items ?? []).map((v: any) => ({ channel: v.snippet.channelTitle, description: v.snippet.description ?? "" })));
}
