/**
 * Testa cupons no checkout do Mercado Livre (tela "Cupons", /cupons/cho?context_id=...), com a sessão do próprio
 * usuário, no navegador dele: a mesma chamada que o campo "Inserir código" faz. Só roda quando o usuário clica.
 * Cada resultado vai para a API (sem dado pessoal): "funcionou" libera o cupom na notificação de quem abrir o produto.
 */
import { useState } from "react";
import type { CouponTestResult } from "@cupons/contracts";
import type { StoredCandidate } from "../messages";

export const ML_PLATFORM = "Mercado Livre";

export function isMlCouponPage(loc: Location = location): boolean {
  return /(^|\.)mercadolivre\.com\.br$/.test(loc.hostname) && loc.pathname.startsWith("/cupons/cho")
    && new URLSearchParams(loc.search).has("context_id");
}

export interface TestOutcome { result: CouponTestResult; message: string }

/** Resposta do ML: responseMessage {type, text} + tracking.event.eventData.response_code ("INVALID_1"). */
export function classify(status: number, body: any): TestOutcome {
  const text: string = body?.responseMessage?.text ?? "";
  const type: string = body?.responseMessage?.type ?? body?.tracking?.event?.eventData?.response_type ?? "";
  const code: string = body?.tracking?.event?.eventData?.response_code ?? "";
  const message = [code, text].filter(Boolean).join(": ").slice(0, 300) || `HTTP ${status}`;
  const t = `${code} ${text}`.toLowerCase();
  if (/n[ãa]o est[áa] mais dispon[íi]vel|expir|esgot|unavailable/.test(t)) return { result: "expired", message };
  if (/n[ãa]o se aplica|salvo em|not_applicable|not_eligible/.test(t)) return { result: "not_applicable", message };
  if (/^invalid|confira se o cupom est[áa] correto|inv[áa]lid/.test(t.trim())) return { result: "invalid", message };
  if (status < 300 && (/success|applied|ok/i.test(type) || /aplicad|adicionad/.test(t))) return { result: "works", message };
  return { result: "unknown", message };
}

/** Firefox: fetch do content script não leva os cookies da página; content.fetch roda como a página. */
const pageFetch: typeof fetch = ((globalThis as any).content?.fetch ?? fetch).bind(globalThis);

export async function testCode(code: string): Promise<TestOutcome> {
  const contextId = new URLSearchParams(location.search).get("context_id") ?? "";
  const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? "";
  if (!csrf) return { result: "unknown", message: "csrf-token ausente na página" };
  const r = await pageFetch(`/cupons/api/input-code/cho?context_id=${encodeURIComponent(contextId)}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json, text/plain, */*", "x-csrf-token": csrf },
    body: JSON.stringify({ coupon_input_code: code }),
  });
  let body: any = null;
  try { body = await r.json(); } catch { /* resposta sem JSON */ }
  return classify(r.status, body);
}

const ICON: Record<CouponTestResult, string> = { works: "✓", not_applicable: "✗", expired: "⌛", invalid: "✗", unknown: "?" };
const LABEL: Record<CouponTestResult, string> = {
  works: "funcionou", not_applicable: "não vale para esta compra", expired: "expirado", invalid: "código inválido", unknown: "sem resposta clara",
};

interface Props {
  candidates: StoredCandidate[];
  onResult: (c: StoredCandidate, o: TestOutcome) => void;
  onClose: () => void;
}

export function CheckoutTester({ candidates, onResult, onClose }: Props) {
  const [results, setResults] = useState<Record<string, TestOutcome>>({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  async function run() {
    setRunning(true);
    const works: StoredCandidate[] = [];
    for (const c of candidates) {
      const o = await testCode(c.code).catch((e) => ({ result: "unknown" as const, message: String(e).slice(0, 120) }));
      setResults((r) => ({ ...r, [c.code]: o }));
      onResult(c, o);
      if (o.result === "works") works.push(c);
      await new Promise((r) => setTimeout(r, 1000)); // 1 por segundo: o checkout é do usuário, sem rajadas
    }
    // o último aplicado é o que fica: reaplica o primeiro que funcionou (candidatos vêm do mais provável ao menos)
    if (works.length > 1) await testCode(works[0].code).catch(() => undefined);
    setRunning(false);
    setDone(true);
  }

  const worked = Object.values(results).filter((o) => o.result === "works").length;
  return (
    <div className="card" role="dialog" aria-label="Testar cupons nesta compra">
      <div className="head">
        <span className="logo">%</span>
        <div className="title">
          <b>{done ? (worked ? `${worked} cupom${worked > 1 ? "s" : ""} funcionou` : "Nenhum cupom valeu para esta compra")
            : `Testar ${candidates.length} cupom${candidates.length > 1 ? "s" : ""} nesta compra`}</b>
          <span>{done ? "Atualize a página para ver o desconto" : "O Cupons BR aplica um por um e mostra o resultado"}</span>
        </div>
        <button className="icon" title="Fechar" aria-label="Fechar" onClick={onClose}>×</button>
      </div>
      <div className="list">
        {candidates.map((c) => {
          const o = results[c.code];
          return (
            <div className="item" key={c.code}>
              <span className="c">{c.code}</span>
              <span className="l">{o ? `${ICON[o.result]} ${LABEL[o.result]}` : running ? "na fila…" : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="buy" style={{ paddingTop: 10 }}>
        {!done ? (
          <button className="btn primary" disabled={running} onClick={run}>
            <span className="p">{running ? "Testando…" : "Testar agora"}</span>
          </button>
        ) : (
          <button className="btn primary" onClick={() => location.reload()}><span className="p">Atualizar página</span></button>
        )}
      </div>
      <div className="foot">
        <span>Cupons recusados ficam salvos em "Cupons" na sua conta.</span>
      </div>
    </div>
  );
}
