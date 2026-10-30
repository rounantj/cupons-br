/**
 * Telegram: posts recentes de canais públicos de ofertas pela página t.me/s/<canal> (pública, sem login).
 * Canais: semente + descoberta automática (links t.me em descrições do YouTube e nos próprios posts).
 * Só canais brasileiros (posts em R$).
 */
import { productMismatch } from "@cupons/core";
import { cacheGet, cacheSet, query } from "@cupons/db";
import { getText } from "./http";
import { CreatorContent, OFFER, SourceResult, SPANISH } from "./types";
import { recentYoutubeDescriptions } from "./youtube";

const HOT_DAYS = 7;
const CHANNELS_PER_SEARCH = 15;
const PAGES_PER_CHANNEL = 3;
const CACHE_SECONDS = 20 * 60;
const MAX_POSTS = 60;

const TG_LINK = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})\b/g;
const NOT_CHANNEL = new Set(["joinchat", "share", "addlist", "addstickers", "proxy", "iv", "s"]);
const COUPON_HEAD = /cupo[mn]|c[óo]digo/i;
const PLATFORM_NAME = /mercado\s*livre|amazon|shopee|magalu|magazine\s*luiza|kabum|casas\s*bahia|americanas|aliexpress/i;

interface Post { id: string; text: string; date: string }
interface Page { title: string; posts: Post[] }

/** Entidades HTML com nome e numéricas (o Telegram escreve o cifrão como "R&#036;"). */
const NAMED: Record<string, string> = { quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", amp: "&" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : NAMED[e.toLowerCase()] ?? m);

function postText(fragment: string): string {
  return decode(
    fragment
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, label) => (label.startsWith("http") || !label.trim() ? href : `${label} ${href}`))
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

async function page(username: string, before?: string): Promise<Page> {
  const url = `https://t.me/s/${username}${before ? `?before=${before}` : ""}`;
  const key = `tg:${url}`;
  const hit = await cacheGet<Page>(key);
  if (hit) return hit;
  const htmlText = await getText(url);
  const title = decode(htmlText.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? username);
  // um bloco por mensagem: evita misturar o texto de um post com a data do seguinte
  const posts = htmlText.split('<div class="tgme_widget_message_wrap').slice(1).flatMap((block) => {
    const id = block.match(/data-post="([^"]+)"/)?.[1];
    const body = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const date = block.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    return id && body && date ? [{ id, text: postText(body), date }] : [];
  });
  const result = { title, posts };
  await cacheSet(key, result, CACHE_SECONDS);
  return result;
}

async function discover(): Promise<number> {
  let found = 0;
  for (const { channel, description } of await recentYoutubeDescriptions()) {
    for (const m of description.matchAll(TG_LINK)) {
      const name = m[1];
      if (NOT_CHANNEL.has(name.toLowerCase()) || name.toLowerCase().endsWith("bot")) continue;
      found += (await query("INSERT INTO telegram_channels (username, discovered_from) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1", [name, channel])).length;
    }
  }
  return found;
}

export async function collectTelegram(productName: string): Promise<SourceResult> {
  const discovered = await discover();
  const cutoff = new Date(Date.now() - HOT_DAYS * 86400_000).toISOString();
  const channels = await query<{ username: string }>(
    `SELECT username FROM telegram_channels
     WHERE is_br IS NOT FALSE OR last_checked_at < now() - interval '7 days'
     ORDER BY coupon_hits DESC, (is_br IS NULL) DESC, last_post_at DESC NULLS LAST LIMIT $1`, [CHANNELS_PER_SEARCH]);
  const items: CreatorContent[] = [];
  const seen = new Set<string>();
  let read = 0, foreign = 0, offers = 0;
  for (const { username } of channels) {
    let first: Page;
    try {
      first = await page(username);
    } catch {
      continue; // falha de rede não classifica o canal
    }
    read++;
    let posts = [...first.posts];
    let current = first;
    for (let p = 1; p < PAGES_PER_CHANNEL && current.posts.length && current.posts[0].date >= cutoff; p++) {
      current = await page(username, current.posts[0].id.split("/")[1]);
      posts = [...current.posts, ...posts];
    }
    // estrangeiro só com amostra suficiente: 10+ posts e quase nenhum preço em R$
    const withBrl = posts.filter((p) => p.text.includes("R$")).length;
    const isBr = withBrl >= 3 ? true : posts.length >= 10 ? false : null;
    const last = posts.map((p) => p.date).sort().at(-1) ?? null;
    await query(`UPDATE telegram_channels SET title = $1, is_br = $2, posts_seen = posts_seen + $3, last_post_at = $4,
                 last_checked_at = now() WHERE username = $5`, [first.title, isBr, posts.length, last, username]);
    if (isBr === false) { foreign++; continue; }
    for (const p of posts) {
      if (p.date < cutoff || !OFFER.test(p.text) || SPANISH.test(p.text)) continue;
      offers++;
      const head = p.text.split("\n").slice(0, 2).join("\n");
      const mentionsProduct = productMismatch(productName, p.text) === null;
      // anúncio de cupom da plataforma ("Cupom Shopee", "Novos cupons Mercado Livre"), não post de outro produto
      const platformCoupon = COUPON_HEAD.test(head) && PLATFORM_NAME.test(head);
      const key = p.text.toLowerCase().replace(/\W+/g, "").slice(0, 300);
      if (!(mentionsProduct || platformCoupon) || seen.has(key)) continue;
      seen.add(key);
      for (const m of p.text.matchAll(TG_LINK)) {
        if (!NOT_CHANNEL.has(m[1].toLowerCase()) && !m[1].toLowerCase().endsWith("bot"))
          await query("INSERT INTO telegram_channels (username, discovered_from) VALUES ($1, $2) ON CONFLICT DO NOTHING", [m[1], `telegram:${username}`]);
      }
      items.push({
        source: "telegram", sourceUrl: `https://t.me/${p.id}`, title: p.text.split("\n")[0].slice(0, 120), creator: first.title,
        creatorId: `tg:${username}`, text: p.text.slice(0, 1500), comments: [], publishedAt: p.date, live: false,
      });
    }
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return {
    items: items.slice(0, MAX_POSTS),
    detail: `${read} canais lidos (${foreign} fora do Brasil), ${discovered} novos descobertos, ${offers} posts com oferta em ${HOT_DAYS} dias, ${Math.min(items.length, MAX_POSTS)} relevantes`,
  };
}
