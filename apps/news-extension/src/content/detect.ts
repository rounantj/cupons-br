/** Matéria aberta: tipo do JSON-LD (NewsArticle…) ou og:type=article; extrai o que o leitor já está vendo. */
import type { NewsPage } from "@cupons/contracts";

const ARTICLE_TYPES = /^(NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|Article|BlogPosting|LiveBlogPosting)$/;
const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim() || undefined;

function jsonLdArticle(): Record<string, any> | null {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? "");
      const nodes: any[] = (Array.isArray(data) ? data : [data]).flatMap((n) => (n?.["@graph"] ? n["@graph"] : [n]));
      const hit = nodes.find((n) => [n?.["@type"]].flat().some((t: string) => ARTICLE_TYPES.test(String(t))));
      if (hit) return hit;
    } catch { /* JSON-LD inválido no site: ignora */ }
  }
  return null;
}

/** Texto da matéria (até 6.000 caracteres): articleBody do JSON-LD ou parágrafos do <article>. */
function articleText(ld: Record<string, any> | null): string | undefined {
  if (typeof ld?.articleBody === "string" && ld.articleBody.length > 200) return ld.articleBody.slice(0, 6000);
  const root = document.querySelector("article") ?? document.querySelector("main") ?? document.body;
  const text = [...root.querySelectorAll("p")].map((p) => p.innerText.trim()).filter((t) => t.length > 60).join("\n");
  return text.length > 200 ? text.slice(0, 6000) : undefined;
}

export function detectArticle(): NewsPage | null {
  const ld = jsonLdArticle();
  if (!ld && meta("og:type") !== "article") return null;
  const title = (meta("og:title") ?? ld?.headline ?? document.querySelector("h1")?.textContent ?? document.title)?.trim();
  if (!title || title.length < 15) return null;
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const image = meta("og:image") ?? [ld?.image].flat()[0]?.url ?? [ld?.image].flat()[0];
  return {
    url: (canonical || location.href).split("#")[0],
    title: title.slice(0, 400),
    description: (meta("og:description") ?? ld?.description)?.slice(0, 1000),
    siteName: meta("og:site_name")?.slice(0, 120),
    publishedAt: (meta("article:published_time") ?? ld?.datePublished)?.slice(0, 40),
    image: typeof image === "string" && image.startsWith("http") ? image : undefined,
    text: articleText(ld),
  };
}
