/**
 * Content script: detecta a página de produto, pede a busca ao service worker, acompanha até "done"
 * e mostra a notificação (só quando há algo útil). Lojas com navegação sem recarga: observa a URL.
 */
import { createRoot, Root } from "react-dom/client";
import type { SearchView } from "@cupons/contracts";
import type { Reply, Request } from "../messages";
import { detectProduct, isProductPage, pageCoupon, PageCoupon } from "./detect";
import { CSS } from "./styles";
import { Searching, Toast } from "./Toast";
import type { ReactNode } from "react";

const POLL_MS = 2500;
const MAX_WAIT_MS = 180_000;
let root: Root | null = null;
let host: HTMLElement | null = null;
let currentRun = 0;

const send = (msg: Request) => chrome.runtime.sendMessage(msg) as Promise<Reply>;

async function settings(): Promise<{ enabled: boolean; hiddenSites: string[] }> {
  const s = await chrome.storage.local.get({ enabled: true, hiddenSites: [] as string[] });
  return { enabled: s.enabled as boolean, hiddenSites: s.hiddenSites as string[] };
}

function unmount() {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
}

function mount(node: ReactNode) {
  unmount();
  host = document.createElement("cupons-br-toast");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const container = document.createElement("div");
  container.className = "wrap";
  shadow.append(style, container);
  document.documentElement.append(host);
  root = createRoot(container);
  root.render(node);
}

function showResult(view: SearchView, onPage: PageCoupon | null) {
  mount(
    <Toast view={view} currentUrl={location.href}
      pageCoupon={onPage && { amount: onPage.amount, text: onPage.text }}
      onShowPageCoupon={() => {
        if (!onPage) return;
        onPage.element.scrollIntoView({ behavior: "smooth", block: "center" });
        const el = onPage.element as HTMLElement;
        const before = el.style.outline;
        el.style.outline = "3px solid #16a34a";
        setTimeout(() => { el.style.outline = before; }, 2500);
      }}
      onClose={() => {
      sessionStorage.setItem(`cupons-br:closed:${view.product?.id}`, "1");
      unmount();
    }} onHideSite={async () => {
      const { hiddenSites } = await settings();
      await chrome.storage.local.set({ hiddenSites: [...new Set([...hiddenSites, location.hostname])] });
      unmount();
    }} />,
  );
}

/** Só incomoda o usuário quando há vantagem real: cupom ou outra loja mais barata. */
function worthShowing(view: SearchView): boolean {
  if (view.coupons.length) return true;
  const here = view.affiliateLinks.find((l) => l.isOriginPage)?.price;
  return view.affiliateLinks.some((l) => !l.isOriginPage && l.price != null && here != null && l.price < here * 0.98);
}

async function run() {
  const run = ++currentRun;
  unmount();
  const { enabled, hiddenSites } = await settings();
  if (!enabled || hiddenSites.includes(location.hostname)) return;
  const page = detectProduct();
  if (!page) return;

  let reply = await send({ type: "search", page });
  const started = Date.now();
  // Busca nova leva ~30-60 s: indicador discreto para não parecer travado (fecha = cancela só a exibição)
  if (reply.ok && !["done", "failed"].includes(reply.view.status)) {
    mount(<Searching onClose={() => { currentRun++; unmount(); }} />);
  }
  while (reply.ok && !["done", "failed"].includes(reply.view.status) && Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (run !== currentRun) return; // usuário trocou de produto
    reply = await send({ type: "poll", id: reply.view.id });
  }
  if (run !== currentRun) return;
  unmount();
  if (!reply.ok || reply.view.status !== "done") return;
  if (sessionStorage.getItem(`cupons-br:closed:${reply.view.product?.id}`)) return;
  // a loja carrega o bloco de cupom depois do preço: lê no fim da busca
  const onPage = pageCoupon();
  if (onPage || worthShowing(reply.view)) showResult(reply.view, onPage);
}

// Primeira carga (aguarda o JSON-LD/título da loja) + mudanças de URL sem recarga.
// Saiu para uma página que não é de produto: a busca anterior continua e a notificação aponta a URL original.
let lastUrl = location.href;
setTimeout(run, 1200);
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (isProductPage()) setTimeout(run, 1200);
  }
}, 1000);
