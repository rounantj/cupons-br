/**
 * Content script: detecta a matéria, pede a busca ao service worker e mostra uma pílula discreta
 * ("5 outras versões"). O painel completo abre num iframe da extensão (o CSP do site não afeta imagens e estilo).
 */
import type { NewsLookupView } from "@cupons/contracts";
import type { Reply, Request } from "../messages";
import { detectArticle } from "./detect";

const POLL_MS = 2000;
const MAX_WAIT_MS = 90_000;
const send = (msg: Request) => chrome.runtime.sendMessage(msg) as Promise<Reply>;

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;

const CSS = `
:host { all: initial; }
.wrap { position: fixed; top: 16px; right: 16px; z-index: 2147483647; font: 600 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.pill { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 7px 12px 7px 7px; border-radius: 999px;
  background: #0f172a; color: #f8fafc; box-shadow: 0 10px 30px rgba(2,6,23,.35); animation: in .3s ease; }
.pill:hover { background: #1e293b; }
.pill img { width: 22px; height: 22px; border-radius: 6px; }
.pill .x { all: unset; cursor: pointer; margin-left: 2px; padding: 0 4px; color: #94a3b8; font-size: 15px; }
.pill.busy { cursor: default; color: #cbd5e1; }
.dot { width: 6px; height: 6px; border-radius: 99px; background: #38bdf8; animation: pulse 1.2s infinite; }
iframe { width: 420px; max-width: calc(100vw - 32px); height: min(720px, calc(100vh - 32px)); border: 0; border-radius: 16px;
  box-shadow: 0 24px 60px rgba(2,6,23,.35); background: transparent; color-scheme: normal; animation: in .3s ease; }
@keyframes in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes pulse { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .pill, iframe, .dot { animation: none; } }
`;

function root(): HTMLElement {
  if (!host) {
    host = document.createElement("panorama-news");
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.append(style);
    document.documentElement.append(host);
  }
  shadow!.querySelector(".wrap")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  shadow!.append(wrap);
  return wrap;
}

function close() {
  host?.remove();
  host = shadow = null;
}

const icon = () => chrome.runtime.getURL("icons/48.png");

function busy() {
  const wrap = root();
  wrap.innerHTML = `<div class="pill busy" role="status"><img alt=""><span class="dot"></span>Procurando outras versões…</div>`;
  wrap.querySelector("img")!.src = icon();
}

function pill(view: NewsLookupView) {
  const n = view.related.length;
  const wrap = root();
  const button = document.createElement("button");
  button.className = "pill";
  button.setAttribute("aria-label", "Abrir outras versões desta notícia");
  const img = document.createElement("img");
  img.src = icon();
  img.alt = "";
  const label = document.createElement("span");
  label.textContent = `${n} outra${n > 1 ? "s" : ""} ${n > 1 ? "versões" : "versão"}${view.analysis ? " · análise" : ""}`;
  const x = document.createElement("span");
  x.className = "x";
  x.textContent = "×";
  x.title = "Fechar";
  x.addEventListener("click", (e) => { e.stopPropagation(); close(); });
  button.append(img, label, x);
  button.addEventListener("click", () => panel(view.id));
  wrap.append(button);
}

function panel(id: string) {
  const wrap = root();
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL(`panel/index.html?id=${encodeURIComponent(id)}`);
  frame.title = "Panorama: outras versões desta notícia";
  wrap.append(frame);
  // o painel pede para fechar via postMessage (fica dentro de um iframe da extensão)
  const onMsg = (e: MessageEvent) => {
    if (e.source === frame.contentWindow && e.data === "panorama:close") { window.removeEventListener("message", onMsg); close(); }
  };
  window.addEventListener("message", onMsg);
}

async function run() {
  const { enabled = true, hiddenSites = [] } = await chrome.storage.local.get({ enabled: true, hiddenSites: [] as string[] });
  if (!enabled || (hiddenSites as string[]).includes(location.hostname)) return;
  const page = detectArticle();
  if (!page) return;
  busy();
  let reply = await send({ type: "lookup", page });
  const started = Date.now();
  // a pílula aparece assim que as coberturas chegam; a análise continua e o painel acompanha
  while (reply.ok && reply.view.status !== "done" && reply.view.status !== "failed" && !reply.view.related.length
    && Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    reply = await send({ type: "poll", id: reply.view.id });
  }
  if (!reply.ok || !reply.view.related.length) return close();
  pill(reply.view);
}

setTimeout(run, 1000);
