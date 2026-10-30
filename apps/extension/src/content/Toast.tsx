import { useState } from "react";
import type { AffiliateLinkView, CouponView, SearchView } from "@cupons/contracts";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: v % 1 ? 2 : 0 });

function couponHeadline(c: CouponView): string {
  if (c.effectivePercent != null) return `${c.effectiveIsEstimate ? "≈ " : ""}-${c.effectivePercent.toLocaleString("pt-BR")}%`;
  if (c.nominalPercent != null) return `-${c.nominalPercent}%`;
  return c.discountLabel ?? "cupom";
}

function couponDetail(c: CouponView): string {
  const parts = [c.samePlatformAsPage ? `${c.platform} (esta loja)` : `no ${c.platform}`];
  if (c.effectivePercent != null && c.discountLabel) parts.push(c.discountLabel);
  else if (c.discountLabel && c.nominalPercent == null) parts.push(c.discountLabel);
  if (c.conditions) parts.push(c.conditions);
  return parts.join(" · ");
}

function CopyButton({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className={`copy${done ? " done" : ""}`} aria-label={`Copiar cupom ${code}`}
      onClick={() => navigator.clipboard.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); })}>
      {done ? "Copiado ✓" : "Copiar"}
    </button>
  );
}

/** Clique do usuário abre o NOSSO link (nunca redireciona sozinho). */
const open = (url: string) => window.open(url, "_blank", "noopener");

interface Props { view: SearchView; currentUrl: string; onClose: () => void; onHideSite: () => void }

export function Toast({ view, currentUrl, onClose, onHideSite }: Props) {
  const [minimized, setMinimized] = useState(false);
  const coupons = view.coupons;
  const links: AffiliateLinkView[] = view.affiliateLinks.filter((l) => l.affiliateUrl || l.productUrl).slice(0, 3);
  const [best, ...rest] = coupons;
  const navigatedAway = view.originUrl && view.originUrl.split("?")[0] !== currentUrl.split("?")[0];

  if (minimized) {
    return (
      <button className="pill" onClick={() => setMinimized(false)} aria-label="Abrir cupons encontrados">
        <span className="logo">%</span>
        {coupons.length ? `${coupons.length} cupom${coupons.length > 1 ? "s" : ""}` : "Ofertas"}
      </button>
    );
  }
  return (
    <div className="card" role="dialog" aria-label="Cupons para este produto">
      <div className="head">
        <span className="logo">%</span>
        <div className="title">
          <b>{coupons.length ? `${coupons.length} cupom${coupons.length > 1 ? "s" : ""} para este produto` : "Ofertas deste produto"}</b>
          <span>{view.product?.name}</span>
        </div>
        <button className="icon" title="Minimizar" aria-label="Minimizar" onClick={() => setMinimized(true)}>–</button>
        <button className="icon" title="Fechar" aria-label="Fechar" onClick={onClose}>×</button>
      </div>

      {best && (
        <div className="best">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="pct">{couponHeadline(best)}</span>
            <span className="meta">{couponDetail(best)}</span>
          </div>
          <div className="row">
            <span className="code" title={best.code}>{best.code}</span>
            <CopyButton code={best.code} />
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div className="list">
          {rest.slice(0, 3).map((c) => (
            <div className="item" key={`${c.platform}:${c.code}`}>
              <span className="c">{c.code}</span>
              <span className="l">{couponHeadline(c)} · {couponDetail(c)}</span>
              <button className="mini" onClick={() => navigator.clipboard.writeText(c.code)}>copiar</button>
            </div>
          ))}
        </div>
      )}

      {navigatedAway && (
        <div className="origin">
          Resultado do produto que você estava vendo: <a href={view.originUrl!} target="_blank" rel="noopener">abrir de novo</a>
        </div>
      )}

      {links.length > 0 && (
        <>
          <div className="section">Comprar com desconto</div>
          <div className="buy">
            {links.map((l, i) => (
              <button key={l.productUrl} className={`btn${i === 0 && !l.isOriginPage ? " primary" : ""}`} onClick={() => open(l.affiliateUrl ?? l.productUrl)}>
                <span className="p">{l.platform}</span>
                {l.isOriginPage && <span className="here">esta página</span>}
                {l.price != null && <span className="v">{brl(l.price)}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="foot">
        <span>Links de afiliado: podemos ganhar comissão, sem custo extra.</span>
        <button onClick={onHideSite}>Ocultar neste site</button>
      </div>
    </div>
  );
}

/** Enquanto a primeira busca do produto roda: pílula discreta, sem bloquear a página. */
export function Searching({ onClose }: { onClose: () => void }) {
  return (
    <div className="pill searching" role="status" aria-live="polite">
      <span className="logo spin">%</span>
      Procurando cupons…
      <button className="icon" title="Fechar" aria-label="Fechar" onClick={onClose}>×</button>
    </div>
  );
}
