/** Shopee Affiliate Open API (BR): gera o link curto de afiliado na NOSSA conta. */
import { createHash } from "node:crypto";

export async function shopeeShortLink(originUrl: string): Promise<{ url: string | null; error?: string }> {
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_SECRET;
  if (!appId || !secret) return { url: null, error: "SHOPEE_APP_ID / SHOPEE_SECRET" };
  const payload = JSON.stringify({
    query: `mutation{generateShortLink(input:{originUrl:${JSON.stringify(originUrl)},subIds:["cuponsbr"]}){shortLink}}`,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = createHash("sha256").update(`${appId}${ts}${payload}${secret}`).digest("hex");
  try {
    const r = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json", Authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${signature}` },
      signal: AbortSignal.timeout(10_000),
    });
    const json: any = await r.json();
    const link = json?.data?.generateShortLink?.shortLink;
    return link ? { url: link } : { url: null, error: JSON.stringify(json).slice(0, 160) };
  } catch (e) {
    return { url: null, error: (e as Error).message };
  }
}
