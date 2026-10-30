/** URL da API definida no build (VITE_API_URL). Na v1 é o túnel ngrok da máquina local. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:3000";

/** Lojas onde a extensão atua (as mesmas do manifest). */
export const STORES = [
  "amazon.com.br", "mercadolivre.com.br", "shopee.com.br", "magazineluiza.com.br",
  "kabum.com.br", "casasbahia.com.br", "americanas.com.br",
];
