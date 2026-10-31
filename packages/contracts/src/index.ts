/**
 * Contrato público da API (usado pelo backend e pela extensão).
 * POST /v1/searches enfileira; GET /v1/searches/:id acompanha até status "done".
 */
import { z } from "zod";

export const PLATFORMS = [
  "Mercado Livre", "Amazon", "Shopee", "Magalu", "KaBuM!", "Casas Bahia", "Americanas", "AliExpress",
  "Carrefour", "Fast Shop", "Submarino", "Pichau", "Terabyte", "Samsung", "Apple", "PlayStation Store",
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** O que a extensão (ou outro cliente) sabe sobre o produto que o usuário está vendo. */
export const PageContextSchema = z.object({
  url: z.string().url().max(2000),
  title: z.string().max(300).optional(),
  productName: z.string().max(300).optional(),
  brand: z.string().max(120).optional(),
  sku: z.string().max(120).optional(),
  gtin: z.string().max(32).optional(),
  price: z.number().positive().max(10_000_000).optional(),
  currency: z.string().length(3).optional(),
  image: z.string().url().max(2000).optional(),
});
export type PageContext = z.infer<typeof PageContextSchema>;

export const CreateSearchSchema = z
  .object({
    query: z.string().min(2).max(200).optional(),
    page: PageContextSchema.optional(),
  })
  .refine((v) => v.query || v.page?.productName || v.page?.title, { message: "informe query ou page.productName" });
export type CreateSearch = z.infer<typeof CreateSearchSchema>;

export type SearchStatus = "queued" | "collecting" | "analyzing" | "linking" | "done" | "failed";
/** full = produto novo (tudo); refresh = produto catalogado, só reaquece cupons; cached = tudo fresco, resposta imediata */
export type SearchMode = "full" | "refresh" | "cached";

export interface CouponView {
  code: string;
  platform: Platform | string;
  /** "10% até R$200 mín R$149" ou "R$ 20 mín R$60" */
  discountLabel: string | null;
  /** desconto efetivo no preço conhecido do produto naquela plataforma (teto/mínimo aplicados) */
  effectivePercent: number | null;
  /** effectivePercent calculado sobre o preço de outra loja (falta o preço nesta plataforma) */
  effectiveIsEstimate: boolean;
  nominalPercent: number | null;
  /** cupom da mesma loja da página que o usuário está vendo */
  samePlatformAsPage: boolean;
  conditions: string | null;
  confidence: number;
  /** quando o cupom foi visto pela última vez (cupons "quentes" primeiro) */
  lastSeenAt: string;
  /** crédito a quem divulgou (texto; nunca o link de afiliado de terceiros) */
  seenAt: string[];
  /** NOSSO link do produto na mesma plataforma, para usar o cupom no carrinho */
  buyUrl: string | null;
  /** último teste "funcionou" num checkout real (só cupons testados aparecem na notificação) */
  verifiedAt: string;
}

/** Cupom ainda não testado: a extensão testa no checkout e só então ele vira CouponView. */
export interface CandidateView { code: string; platform: Platform | string }

export interface AffiliateLinkView {
  platform: Platform | string;
  title: string | null;
  price: number | null;
  priceIsCurrent: boolean;
  productUrl: string;
  /** NOSSO link de afiliado; null quando a credencial da plataforma ainda não foi configurada */
  affiliateUrl: string | null;
  missing: string | null;
  /** é a mesma página que o usuário estava navegando */
  isOriginPage: boolean;
}

export interface SearchView {
  id: string;
  status: SearchStatus;
  mode: SearchMode;
  /** URL que o usuário estava navegando quando a busca começou (ele pode ter mudado de aba) */
  originUrl: string | null;
  product: { id: string; name: string } | null;
  /** só cupons que funcionaram num checkout real recente */
  coupons: CouponView[];
  /** cupons achados nas fontes, ainda sem teste: a extensão testa no checkout */
  candidates: CandidateView[];
  affiliateLinks: AffiliateLinkView[];
  progress: { pendingBatches: number; sources: { source: string; status: string; items: number; detail: string | null }[] };
  createdAt: string;
  finishedAt: string | null;
}

export const COUPON_TEST_RESULTS = ["works", "not_applicable", "expired", "invalid", "unknown"] as const;
export type CouponTestResult = (typeof COUPON_TEST_RESULTS)[number];

/** POST /v1/coupon-tests: resultado de um cupom testado no checkout (sem dado pessoal). */
export const CouponTestSchema = z.object({
  productIds: z.array(z.string().uuid()).max(10).default([]),
  platform: z.enum(PLATFORMS),
  code: z.string().min(3).max(40),
  result: z.enum(COUPON_TEST_RESULTS),
  message: z.string().max(300).optional(),
});
export type CouponTest = z.infer<typeof CouponTestSchema>;
