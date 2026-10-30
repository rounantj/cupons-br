/** Conteúdo de influenciador (vídeo do YouTube ou post do Telegram) a ser analisado pela IA. */
export interface CreatorContent {
  source: "youtube" | "telegram";
  sourceUrl: string;
  title: string;
  creator: string;
  creatorId: string;
  text: string;
  comments: string[];
  publishedAt: string;
  live: boolean;
}

export interface SourceResult { items: CreatorContent[]; detail: string }

/** Canais de outros países (Mercado Libre MX/AR...) aparecem nas buscas; cupom deles não vale no Brasil. */
export const SPANISH = /[¡¿]|mercado\s*libre|env[íi]o\s+gratis|\bcup[óo]n(?:es)?\b|descuento|ofert[óo]n|\bpesos\b/i;
export const OFFER = /cupo[mn]|c[óo]digo|R\$\s?\d|\b\d{1,2}\s?%|\boff\b/i;
