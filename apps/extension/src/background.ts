/**
 * Service worker: única parte que fala com a API. A página nunca vê a URL da API nem faz requisições cruzadas.
 * Busca: POST /v1/searches (enfileira) e o content script acompanha com "poll" (GET) até "done".
 * Cada mensagem acorda o worker, então funciona mesmo com o limite de vida do MV3.
 */
import type { SearchView } from "@cupons/contracts";
import { API_URL } from "./config";
import type { Reply, Request, StoredCandidate } from "./messages";

const HEADERS = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1", "X-Client-Version": chrome.runtime.getManifest().version };
const CACHE_MINUTES = 30;
const CANDIDATE_HOURS = 3; // produto visto há até 3 h provavelmente é o que está no carrinho

async function api(path: string, init?: RequestInit): Promise<SearchView> {
  const r = await fetch(`${API_URL}${path}`, { ...init, headers: HEADERS });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

/** Mesmo produto aberto de novo em 30 min: resposta guardada na sessão do navegador. */
async function fromCache(url: string): Promise<SearchView | null> {
  const key = `view:${url}`;
  const hit = (await chrome.storage.session.get(key))[key] as { at: number; view: SearchView } | undefined;
  return hit && Date.now() - hit.at < CACHE_MINUTES * 60_000 ? hit.view : null;
}

/** Cupons a testar no checkout: junta os candidatos das buscas recentes (por loja). */
async function remember(view: SearchView) {
  if (!view.product || !view.candidates?.length) return;
  const { candidates = [] } = (await chrome.storage.session.get("candidates")) as { candidates?: StoredCandidate[] };
  const fresh = candidates.filter((c) => Date.now() - c.at < CANDIDATE_HOURS * 3600_000);
  for (const c of view.candidates) {
    const same = fresh.find((x) => x.platform === c.platform && x.code.toLowerCase() === c.code.toLowerCase());
    if (same) { same.at = Date.now(); same.productIds = [...new Set([view.product.id, ...same.productIds])].slice(0, 10); }
    else fresh.push({ ...c, productIds: [view.product.id], at: Date.now() });
  }
  await chrome.storage.session.set({ candidates: fresh.slice(-40) });
}

async function handle(msg: Request): Promise<Reply> {
  try {
    if (msg.type === "candidates") {
      const { candidates = [] } = (await chrome.storage.session.get("candidates")) as { candidates?: StoredCandidate[] };
      return { ok: true, candidates: candidates.filter((c) => c.platform === msg.platform && Date.now() - c.at < CANDIDATE_HOURS * 3600_000) };
    }
    if (msg.type === "report") {
      const r = await fetch(`${API_URL}/v1/coupon-tests`, { method: "POST", headers: HEADERS,
        body: JSON.stringify({ productIds: msg.productIds, platform: msg.platform, code: msg.code, result: msg.result, message: msg.message }) });
      if (!r.ok) throw new Error(`API ${r.status}`);
      // testado: sai da lista (funcionou vira cupom verificado na próxima busca)
      const { candidates = [] } = (await chrome.storage.session.get("candidates")) as { candidates?: StoredCandidate[] };
      await chrome.storage.session.set({ candidates: candidates.filter((c) => !(c.platform === msg.platform && c.code === msg.code)) });
      if (msg.result === "works") await chrome.storage.session.remove(Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith("view:")));
      return { ok: true };
    }
    if (msg.type === "search") {
      const hit = await fromCache(msg.page.url);
      if (hit) return { ok: true, view: hit };
      const view = await api("/v1/searches", { method: "POST", body: JSON.stringify({ page: msg.page }) });
      if (view.status === "done") {
        await chrome.storage.session.set({ [`view:${msg.page.url}`]: { at: Date.now(), view } });
        await remember(view);
      }
      return { ok: true, view };
    }
    const view = await api(`/v1/searches/${encodeURIComponent(msg.id)}`);
    if (view.status === "done" && view.originUrl) {
      await chrome.storage.session.set({ [`view:${view.originUrl}`]: { at: Date.now(), view } });
    }
    if (view.status === "done") await remember(view);
    return { ok: true, view };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, reply) => {
  handle(msg).then(reply);
  return true; // resposta assíncrona
});
