/** Conteúdo a ser analisado pela IA: vídeo do YouTube, post do Telegram ou oferta/cupom de agregador. */
export interface CreatorContent {
  source: "youtube" | "telegram" | "pelando" | "promobit";
  sourceUrl: string;
  title: string;
  creator: string;
  creatorId: string;
  text: string;
  comments: string[];
  publishedAt: string;
  live: boolean;
  /** temperatura/votos da comunidade (Pelando): negativo = "não funcionou" */
  votes?: number;
  /** selo "Verificado hoje" do Pelando: a comunidade confirmou que o cupom funcionou hoje */
  verified?: boolean;
}

export interface SourceResult { items: CreatorContent[]; detail: string }

/** Canais de outros países (Mercado Libre MX/AR...) aparecem nas buscas; cupom deles não vale no Brasil. */
export const SPANISH = /[¡¿]|mercado\s*libre|env[íi]o\s+gratis|\bcup[óo]n(?:es)?\b|descuento|ofert[óo]n|\bpesos\b/i;
export const OFFER = /cupo[mn]|c[óo]digo|R\$\s?\d|\b\d{1,2}\s?%|\boff\b/i;
