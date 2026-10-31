import type { CandidateView, CouponTestResult, PageContext, SearchView } from "@cupons/contracts";

export type Request =
  | { type: "search"; page: PageContext }
  | { type: "poll"; id: string }
  | { type: "candidates"; platform: string }
  | { type: "report"; platform: string; code: string; result: CouponTestResult; message?: string; productIds: string[] };

/** Candidato guardado na sessão do navegador, com os produtos (buscados recentemente) que o trouxeram. */
export interface StoredCandidate extends CandidateView { productIds: string[]; at: number }

export type ViewReply = { ok: true; view: SearchView } | { ok: false; error: string };

export type Reply =
  | { ok: true; view: SearchView }
  | { ok: true; candidates: StoredCandidate[] }
  | { ok: true }
  | { ok: false; error: string };
