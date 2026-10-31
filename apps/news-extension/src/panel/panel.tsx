import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NewsAnalysisView, NewsLookupView, NewsSourceView } from "@cupons/contracts";
import type { Reply, Request } from "../messages";
import "./panel.css";

const NICHE: Record<string, string> = {
  geral: "Geral", politica: "Política", economia: "Economia", esportes: "Esportes", tecnologia: "Tecnologia", entretenimento: "Entretenimento",
  saude: "Saúde", ciencia: "Ciência", mundo: "Mundo", regional: "Regional", juridico: "Jurídico",
};
const TONE: Record<string, string> = {
  neutro: "neutro", informativo: "informativo", critico: "crítico", favoravel: "favorável", alarmista: "alarmista",
  opinativo: "opinativo", sensacionalista: "sensacionalista",
};

const send = (msg: Request) => chrome.runtime.sendMessage(msg) as Promise<Reply>;
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

function ago(iso: string | null): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} dias`;
}

/** Prévia do link, como o WhatsApp: imagem da matéria (og:image), veículo, manchete e descrição. */
function Preview({ s, tone }: { s: NewsSourceView; tone?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <a className="card" href={s.url} target="_blank" rel="noopener noreferrer">
      {s.image && !broken
        ? <img className="thumb" src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <div className="thumb fav"><img src={favicon(s.domain)} alt="" /></div>}
      <div className="body">
        <div className="src">
          <img src={favicon(s.domain)} alt="" /> {s.site} {s.publishedAt && <>· {ago(s.publishedAt)}</>}
          {tone && <span className={`chip tone-${tone}`}>{TONE[tone] ?? tone}</span>}
        </div>
        <h3>{s.title}</h3>
        {s.description && s.description !== s.title && <p>{s.description}</p>}
        {s.headlineOnly && <p>Só a manchete foi comparada{s.viaGoogle ? " · via Google Notícias" : ""}</p>}
      </div>
    </a>
  );
}

function Analysis({ a, view }: { a: NewsAnalysisView; view: NewsLookupView }) {
  const domainOfRef = new Map([view.article, ...view.related].filter(Boolean).map((s) => [s!.ref, s!.domain]));
  return (
    <>
      <section>
        <h2>Em resumo</h2>
        <div className="summary">{a.summary}</div>
      </section>
      {a.consensus.length > 0 && (
        <section>
          <h2>Todos concordam</h2>
          <ul className="clean">{a.consensus.map((c, i) => <li key={i} className="ok">{c}</li>)}</ul>
        </section>
      )}
      {a.divergences.length > 0 && (
        <section>
          <h2>Onde as versões divergem</h2>
          {a.divergences.map((d, i) => (
            <div className="div" key={i}>
              <b>{d.topic}</b>
              {d.positions.map((p, j) => (
                <div className="pos" key={j}><span className="chip">{p.site}</span><span>{p.says}</span></div>
              ))}
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>Como cada veículo enquadra</h2>
        {a.sources.map((s) => (
          <div className="frame" key={s.ref}>
            <div className="top">
              <img src={favicon(domainOfRef.get(s.ref) ?? "")} alt="" />
              {s.site}{s.ref === 0 && <span className="chip">você está lendo</span>}
              <span className={`chip tone-${s.tone}`}>{TONE[s.tone] ?? s.tone}</span>
            </div>
            <div>{s.framing}</div>
            {s.emphasis && <div className="em">Destaca: {s.emphasis}</div>}
            {(s.voices.length > 0 || s.loadedWords.length > 0) && (
              <div className="tags">
                {s.voices.map((v) => <span className="chip" key={v}>ouve: {v}</span>)}
                {s.loadedWords.map((w) => <span className="chip loaded" key={w} title="palavra carregada">“{w}”</span>)}
              </div>
            )}
            {s.evidence && <blockquote>“{s.evidence}”</blockquote>}
          </div>
        ))}
      </section>
      {a.missing.length > 0 && (
        <section>
          <h2>O que nenhuma cobertura respondeu</h2>
          <ul className="clean">{a.missing.map((m, i) => <li key={i} className="q">{m}</li>)}</ul>
        </section>
      )}
      {a.balance && (
        <section>
          <h2>Equilíbrio da cobertura</h2>
          <div className="balance">{a.balance}</div>
        </section>
      )}
    </>
  );
}

function App() {
  const id = new URLSearchParams(location.search).get("id") ?? "";
  const [view, setView] = useState<NewsLookupView | null>(null);
  const [tab, setTab] = useState<"sources" | "analysis">("sources");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await send({ type: "poll", id });
      if (stop) return;
      if (!r.ok) { setError(r.error); return; }
      setView(r.view);
      if (r.view.status !== "done" && r.view.status !== "failed") setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; };
  }, [id]);

  const close = () => parent.postMessage("panorama:close", "*");
  const tones = new Map(view?.analysis?.sources.map((s) => [s.ref, s.tone]) ?? []);
  const analyzing = view && !view.analysis && view.status !== "done" && view.status !== "failed";

  return (
    <div className="panel">
      <header>
        <img src={chrome.runtime.getURL("icons/48.png")} alt="" />
        <div className="t">
          <b>Panorama {view?.niche && <span className="chip niche">{NICHE[view.niche] ?? view.niche}</span>}</b>
          <span>{view?.article?.title ?? "Carregando…"}</span>
        </div>
        <button className="icon" title="Fechar" aria-label="Fechar" onClick={close}>×</button>
      </header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "sources"} onClick={() => setTab("sources")}>
          Coberturas {view ? `(${view.related.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "analysis"} onClick={() => setTab("analysis")}>
          Análise {analyzing && "…"}
        </button>
      </div>
      <main>
        {error && <div className="empty">Não foi possível carregar ({error}).</div>}
        {!error && !view && <div className="wait"><span className="dot" />Carregando…</div>}
        {view && tab === "sources" && (
          <>
            {view.article && <div className="reading">Você está lendo: {view.article.site}</div>}
            {view.related.map((s) => <Preview key={s.url} s={s} tone={tones.get(s.ref)} />)}
            {!view.related.length && <div className="empty">Nenhuma outra cobertura encontrada ainda.</div>}
          </>
        )}
        {view && tab === "analysis" && (
          view.analysis ? <Analysis a={view.analysis} view={view} />
            : analyzing ? <div className="wait"><span className="dot" />Lendo as matérias e comparando a cobertura…</div>
              : <div className="empty">Análise indisponível para esta notícia.</div>
        )}
      </main>
      <footer>Análise automática por IA a partir dos textos públicos de cada veículo. Confira as fontes.</footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
