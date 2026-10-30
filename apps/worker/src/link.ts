/** search.link: NOSSO link de afiliado para cada página do produto; fecha a busca. */
import { credentialsFromEnv, ourLink, productOf } from "@cupons/core";
import { query } from "@cupons/db";
import { shopeeShortLink } from "@cupons/sources";

export async function handleLink(job: { searchId: string; productId: string }) {
  const { searchId, productId } = job;
  const creds = credentialsFromEnv();
  const listings = await query<{ id: string; url: string; affiliate_url: string | null }>(
    "SELECT id, url, affiliate_url FROM listings WHERE product_id = $1", [productId]);
  for (const l of listings) {
    const ref = productOf(l.url);
    if (!ref) continue;
    const link = ourLink(ref, creds);
    let url = link.url;
    if (link.needsShopeeApi && !l.affiliate_url) url = (await shopeeShortLink(ref.url)).url;
    if (url && url !== l.affiliate_url) await query("UPDATE listings SET affiliate_url = $1, updated_at = now() WHERE id = $2", [url, l.id]);
  }
  const mode = (await query<{ mode: string }>("SELECT mode FROM searches WHERE id = $1", [searchId]))[0]?.mode;
  await query(
    `UPDATE products SET coupons_refreshed_at = now(),
       catalogued_at = CASE WHEN $2 = 'full' THEN now() ELSE catalogued_at END WHERE id = $1`, [productId, mode]);
  await query("UPDATE searches SET status = 'done', finished_at = now() WHERE id = $1", [searchId]);
}
