/** Segue o link divulgado (meli.la, amzn.to, s.shopee...) até a página real, sem baixar o conteúdo. */
import { productOf } from "@cupons/core";
import { cacheGet, cacheSet } from "@cupons/db";
import { USER_AGENT } from "./http";

const TTL = 7 * 24 * 3600;

export async function resolveUrl(url: string): Promise<string> {
  const key = `resolve:${url}`;
  const hit = await cacheGet<string>(key);
  if (hit) return hit;
  let current = url;
  for (let i = 0; i < 6; i++) {
    // Já é página de produto: para aqui (o Mercado Livre manda robôs para "verificação de conta")
    if (productOf(current)) break;
    let r: Response;
    try {
      r = await fetch(current, { redirect: "manual", headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      await r.body?.cancel();
    } catch {
      break;
    }
    const location = r.headers.get("location");
    if (r.status < 300 || r.status >= 400 || !location) break;
    current = new URL(location, current).toString();
  }
  // Falha temporária não fica 7 dias no cache
  if (current !== url || productOf(current)) await cacheSet(key, current, TTL);
  return current;
}
