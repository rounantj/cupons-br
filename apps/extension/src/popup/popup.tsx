import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { API_URL, STORES } from "../config";

const css = `
  :root { --bg:#fff; --ink:#14181f; --muted:#5f6b7a; --line:#e7eaef; --accent:#0e9f6e; --chip:#f2f5f8; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161b22; --ink:#e8edf3; --muted:#9aa6b4; --line:#2a313b; --accent:#34d399; --chip:#202731; } }
  body { margin:0; width:300px; background:var(--bg); color:var(--ink); font:13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .p { padding:14px; } h1 { font-size:15px; margin:0 0 2px; display:flex; gap:8px; align-items:center; }
  .logo { width:24px; height:24px; border-radius:7px; background:var(--accent); color:#fff; display:grid; place-items:center; font-weight:800; font-size:12px; }
  .muted { color:var(--muted); font-size:12px; } .row { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-top:1px solid var(--line); }
  .chip { display:inline-block; background:var(--chip); border-radius:999px; padding:2px 8px; margin:2px; font-size:11px; }
  button { font:inherit; } .link { all:unset; cursor:pointer; color:var(--accent); font-size:12px; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:6px; }
`;

function Popup() {
  const [enabled, setEnabled] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    chrome.storage.local.get({ enabled: true, hiddenSites: [] }).then((s) => { setEnabled(s.enabled as boolean); setHidden(s.hiddenSites as string[]); });
    fetch(`${API_URL}/health`, { headers: { "ngrok-skip-browser-warning": "1" } }).then((r) => setOnline(r.ok)).catch(() => setOnline(false));
  }, []);
  const toggle = async () => { await chrome.storage.local.set({ enabled: !enabled }); setEnabled(!enabled); };
  const unhide = async (site: string) => { const next = hidden.filter((h) => h !== site); await chrome.storage.local.set({ hiddenSites: next }); setHidden(next); };
  return (
    <div className="p">
      <style>{css}</style>
      <h1><span className="logo">%</span>Cupons BR</h1>
      <div className="muted">Cupons e melhores preços no produto que você está vendo.</div>
      <div className="row" style={{ marginTop: 10 }}>
        <span>Mostrar ofertas automaticamente</span>
        <input type="checkbox" checked={enabled} onChange={toggle} aria-label="Ativar" />
      </div>
      <div className="row">
        <span><span className="dot" style={{ background: online == null ? "#aaa" : online ? "#0e9f6e" : "#d14343" }} />Serviço</span>
        <span className="muted">{online == null ? "verificando…" : online ? "online" : "indisponível"}</span>
      </div>
      {hidden.length > 0 && (
        <div className="row" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>Ocultado nestes sites:</div>
          {hidden.map((h) => <span className="chip" key={h}>{h} <button className="link" onClick={() => unhide(h)}>mostrar</button></span>)}
        </div>
      )}
      <div className="row" style={{ display: "block" }}>
        <div className="muted" style={{ marginBottom: 4 }}>Funciona em:</div>
        {STORES.map((s) => <span className="chip" key={s}>{s}</span>)}
      </div>
      <div className="muted" style={{ marginTop: 6 }}>Alguns links são de afiliado: podemos ganhar comissão, sem custo extra para você.</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
