/** fetch com user-agent identificado e no máximo 1 requisição por segundo por host. */
export const USER_AGENT = "CuponsBR/0.1 (+https://github.com/rounantj/cupons-br)";
const lastHit = new Map<string, number>();

export async function politeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const host = new URL(url).host;
  const wait = 1000 - (Date.now() - (lastHit.get(host) ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
  return fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR", ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

export async function getText(url: string): Promise<string> {
  const r = await politeFetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}

export async function getJson<T = any>(url: string): Promise<T> {
  const r = await politeFetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}
