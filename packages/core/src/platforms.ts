/** Plataformas aceitas no resultado, reconhecidas pelo domínio do link (inclui encurtadores) ou pelo nome. */
import type { Platform } from "@cupons/contracts";

const RULES: [Platform, RegExp][] = [
  ["Mercado Livre", /mercado\s*livre|mercadolivre\.com|meli\.la|mercadolivre/i],
  ["Amazon", /amazon(?!\.(?!com\.br)[a-z])|amzn\.to/i],
  ["Shopee", /shopee/i],
  ["Magalu", /magalu|magazine\s*luiza|magazineluiza|magazinevoce/i],
  ["KaBuM!", /kabum/i],
  ["Casas Bahia", /casas\s*bahia|casasbahia/i],
  ["Americanas", /americanas/i],
  ["AliExpress", /aliexpress/i],
  ["Carrefour", /carrefour/i],
  ["Fast Shop", /fast\s*shop|fastshop/i],
  ["Submarino", /submarino/i],
  ["Pichau", /pichau/i],
  ["Terabyte", /terabyte/i],
  ["Samsung", /samsung\.com/i],
  ["Apple", /apple\.com/i],
  ["PlayStation Store", /store\.playstation|playstation\.com/i],
];

/** Link de loja estrangeira (preço em outra moeda). */
export const FOREIGN_URL = /https?:\/\/[^/\s]*(?:amazon\.(?!com\.br)[a-z.]+|\.(?:in|us|uk|de|fr|es|mx|ar|cl|co|ca|au|jp|cn))(?:\/|$)/i;

export function platformOf(store?: string | null, url?: string | null): Platform | null {
  for (const value of [url, store]) {
    if (!value) continue;
    for (const [name, rx] of RULES) if (rx.test(value)) return name;
  }
  return null;
}

/** "Amazon (Link: https://...)" -> "Amazon" */
export function cleanStore(store?: string | null): string {
  const name = (store ?? "").trim().split(/\s*[([:|-]\s*/)[0].trim();
  return ["https", "http", "?", "link", "site", "loja"].includes(name.toLowerCase()) ? "" : name;
}
