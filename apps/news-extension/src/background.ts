/**
 * Service worker: única parte que fala com a API (content script e painel pedem por mensagem).
 * POST /v1/news/lookups enfileira (ou reaproveita a análise de outro leitor); GET acompanha até "done".
 */
import type { NewsLookupView } from "@cupons/contracts";
import { API_URL } from "./config";
import type { Reply, Request } from "./messages";

const HEADERS = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1", "X-Client": `panorama/${chrome.runtime.getManifest().version}` };

async function api(path: string, init?: RequestInit): Promise<NewsLookupView> {
  const r = await fetch(`${API_URL}${path}`, { ...init, headers: HEADERS });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

async function handle(msg: Request): Promise<Reply> {
  try {
    const view = msg.type === "lookup"
      ? await api("/v1/news/lookups", { method: "POST", body: JSON.stringify({ page: msg.page }) })
      : await api(`/v1/news/lookups/${encodeURIComponent(msg.id)}`);
    return { ok: true, view };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, reply) => {
  handle(msg).then(reply);
  return true;
});
