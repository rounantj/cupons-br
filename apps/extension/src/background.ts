/**
 * Service worker: única parte que fala com a API. A página nunca vê a URL da API nem faz requisições cruzadas.
 * Busca: POST /v1/searches (enfileira) e o content script acompanha com "poll" (GET) até "done".
 * Cada mensagem acorda o worker, então funciona mesmo com o limite de vida do MV3.
 */
import type { SearchView } from "@cupons/contracts";
import { API_URL } from "./config";
import type { Reply, Request } from "./messages";

const HEADERS = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1", "X-Client-Version": chrome.runtime.getManifest().version };
const CACHE_MINUTES = 30;

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

async function handle(msg: Request): Promise<Reply> {
  try {
    if (msg.type === "search") {
      const hit = await fromCache(msg.page.url);
      if (hit) return { ok: true, view: hit };
      const view = await api("/v1/searches", { method: "POST", body: JSON.stringify({ page: msg.page }) });
      if (view.status === "done") await chrome.storage.session.set({ [`view:${msg.page.url}`]: { at: Date.now(), view } });
      return { ok: true, view };
    }
    const view = await api(`/v1/searches/${encodeURIComponent(msg.id)}`);
    if (view.status === "done" && view.originUrl) {
      await chrome.storage.session.set({ [`view:${view.originUrl}`]: { at: Date.now(), view } });
    }
    return { ok: true, view };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, reply) => {
  handle(msg).then(reply);
  return true; // resposta assíncrona
});
