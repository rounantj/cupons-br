import { Injectable, Logger } from "@nestjs/common";
import { embed } from "@cupons/ai";
import { AffiliateLinkView, CouponView, CreateSearch, SearchMode, SearchView } from "@cupons/contracts";
import { canonicalKey, credentialsFromEnv, discountLabel, finalPrice, ourLink, productOf, ProductRef, sameProduct } from "@cupons/core";
import { getQueue, one, query, QUEUES, toVector } from "@cupons/db";

/** Produto com busca completa mais nova que isto não é recatalogado (só os cupons são reaquecidos). */
const PRODUCT_TTL_HOURS = Number(process.env.PRODUCT_TTL_HOURS ?? 72);
/** Cupons mais velhos que isto são reaquecidos na próxima busca. */
const COUPON_TTL_MINUTES = Number(process.env.COUPON_TTL_MINUTES ?? 60);
/** Distância de cosseno máxima para um produto ser CANDIDATO (o código confirma número/versão do modelo). */
const CANDIDATE_DISTANCE = Number(process.env.CANDIDATE_DISTANCE ?? 0.3);
/** Só cupons vistos recentemente: a ideia é oferecer coisas quentes. */
const HOT_DAYS = Number(process.env.COUPON_HOT_DAYS ?? 14);
/** Só cupons com evidência de valer para o produto (cupom de campanha "talvez sirva" frustra o usuário no checkout). */
const MIN_CONFIDENCE = 0.6;

/** "Apple iPhone 17 256GB | Amazon.com.br" -> "Apple iPhone 17 256GB" */
function cleanTitle(title: string): string {
  return title.split(/\s+[|–-]\s+(?=[^|–-]*(?:amazon|mercado|shopee|magalu|magazine|kabum|americanas|casas bahia)[^|–-]*$)/i)[0]
    .replace(/\s+/g, " ").trim().slice(0, 200);
}

@Injectable()
export class SearchesService {
  private readonly log = new Logger(SearchesService.name);

  async create(body: CreateSearch): Promise<SearchView> {
    const name = cleanTitle(body.page?.productName || body.query || body.page?.title || "");
    const origin = body.page?.url ? productOf(body.page.url) : null;
    const productId = await this.resolveProduct(name, origin, body.page?.gtin);
    if (origin) await this.saveOriginListing(productId, origin, name, body.page?.price);

    // Mesmo produto já em pesquisa: devolve a busca em andamento em vez de duplicar o trabalho
    const inflight = await one<{ id: string }>(
      `SELECT id FROM searches WHERE product_id = $1 AND status NOT IN ('done', 'failed')
       AND created_at > now() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1`, [productId]);
    if (inflight) return (await this.view(inflight.id, body.page?.url))!;

    const p = (await one<{ catalogued_at: Date | null; coupons_refreshed_at: Date | null }>(
      "UPDATE products SET search_count = search_count + 1 WHERE id = $1 RETURNING catalogued_at, coupons_refreshed_at", [productId]))!;
    const age = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 60_000 : Infinity);
    const mode: SearchMode = age(p.catalogued_at) > PRODUCT_TTL_HOURS * 60 ? "full"
      : age(p.coupons_refreshed_at) > COUPON_TTL_MINUTES ? "refresh" : "cached";

    const search = (await one<{ id: string }>(
      `INSERT INTO searches (product_id, query, page, mode, status, finished_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'cached' THEN now() END) RETURNING id`,
      [productId, name, body.page ? JSON.stringify(body.page) : null, mode, mode === "cached" ? "done" : "queued"]))!;
    if (mode !== "cached") {
      await (await getQueue()).send(QUEUES.collect, { searchId: search.id, productId, mode }, { retryLimit: 1, retryDelay: 15 });
    }
    this.log.log(`busca ${search.id} "${name}" modo=${mode}`);
    return (await this.view(search.id))!;
  }

  /** Página que o usuário está vendo -> GTIN -> nome normalizado -> vetor do nome -> produto novo. */
  private async resolveProduct(name: string, origin: ProductRef | null, gtin?: string): Promise<string> {
    if (origin) {
      const byListing = await one<{ product_id: string; name: string }>(
        `SELECT l.product_id, p.name FROM listings l JOIN products p ON p.id = l.product_id
         WHERE l.platform = $1 AND l.external_id = $2`, [origin.platform, origin.externalId]);
      // a página só decide o produto se o nome não contradiz (ex.: página do "17 Pro" ligada ao "17")
      if (byListing && sameProduct(name, byListing.name)) return byListing.product_id;
      if (byListing) {
        this.log.warn(`listing ${origin.platform}/${origin.externalId} estava em "${byListing.name}", página diz "${name}": reassociando`);
        await query("DELETE FROM listings WHERE platform = $1 AND external_id = $2", [origin.platform, origin.externalId]);
      }
    }
    if (gtin) {
      const byGtin = await one<{ id: string }>("SELECT id FROM products WHERE gtin = $1", [gtin]);
      if (byGtin) return byGtin.id;
    }
    const key = canonicalKey(name);
    const byKey = await one<{ id: string }>("SELECT id FROM products WHERE canonical_key = $1", [key]);
    if (byKey) return byKey.id;

    let vector: string | null = null;
    if (process.env.OPENAI_API_KEY) {
      try {
        vector = toVector((await embed([name]))[0]);
        // Vetor sugere, o código confirma: embeddings deixam "iPhone 17" perto de "iPhone 17 Pro"
        const candidates = await query<{ id: string; name: string; distance: number }>(
          `SELECT id, name, embedding <=> $1 AS distance FROM products WHERE embedding IS NOT NULL
           ORDER BY embedding <=> $1 LIMIT 5`, [vector]);
        const match = candidates.find((c) => c.distance <= CANDIDATE_DISTANCE && sameProduct(name, c.name));
        if (match) {
          this.log.log(`"${name}" reconhecido como "${match.name}" (vetor ${match.distance.toFixed(3)} + mesmo modelo)`);
          return match.id;
        }
      } catch (e) {
        this.log.warn(`embedding indisponível: ${(e as Error).message}`);
      }
    }
    const created = await one<{ id: string }>(
      `INSERT INTO products (name, canonical_key, gtin, embedding) VALUES ($1, $2, $3, $4)
       ON CONFLICT (canonical_key) DO UPDATE SET name = products.name RETURNING id`, [name, key, gtin ?? null, vector]);
    return created!.id;
  }

  /** A página que o usuário está vendo já é uma listing: o NOSSO link dela sai na primeira resposta. */
  private async saveOriginListing(productId: string, ref: ProductRef, title: string, price?: number) {
    const link = ourLink(ref, credentialsFromEnv());
    await query(
      `INSERT INTO listings (product_id, platform, external_id, url, title, price, price_seen_at, affiliate_url, source)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::numeric IS NULL THEN NULL ELSE now() END, $7, 'origin_page')
       ON CONFLICT (platform, external_id) DO UPDATE SET
         price = coalesce(EXCLUDED.price, listings.price),
         price_seen_at = CASE WHEN EXCLUDED.price IS NULL THEN listings.price_seen_at ELSE now() END,
         affiliate_url = coalesce(EXCLUDED.affiliate_url, listings.affiliate_url), updated_at = now()`,
      [productId, ref.platform, ref.externalId, ref.url, title, price ?? null, link.url],
    );
  }

  async view(searchId: string, originUrlOverride?: string): Promise<SearchView | null> {
    const s = await one<any>(
      `SELECT s.*, p.name AS product_name FROM searches s LEFT JOIN products p ON p.id = s.product_id WHERE s.id = $1`, [searchId]);
    if (!s) return null;
    const originUrl: string | null = originUrlOverride ?? s.page?.url ?? null;
    const originRef = originUrl ? productOf(originUrl) : null;
    const creds = credentialsFromEnv();

    const listings = await query<any>(
      `SELECT platform, external_id, url, title, price::float AS price, price_seen_at, affiliate_url, source
       FROM listings WHERE product_id = $1 ORDER BY price NULLS LAST`, [s.product_id]);
    const affiliateLinks: AffiliateLinkView[] = listings.map((l) => {
      const ref = { platform: l.platform, externalId: l.external_id, url: l.url } as ProductRef;
      return {
        platform: l.platform,
        title: l.title,
        price: l.price,
        priceIsCurrent: Boolean(l.price_seen_at && Date.now() - new Date(l.price_seen_at).getTime() < 7 * 86400_000),
        productUrl: l.url,
        affiliateUrl: l.affiliate_url ?? ourLink(ref, creds).url,
        missing: l.affiliate_url ? null : ourLink(ref, creds).missing,
        isOriginPage: Boolean(originRef && originRef.platform === l.platform && originRef.externalId === l.external_id),
      };
    });
    // A página de origem primeiro; depois as com link nosso e preço atual
    affiliateLinks.sort((a, b) => Number(b.isOriginPage) - Number(a.isOriginPage) || Number(!!b.affiliateUrl) - Number(!!a.affiliateUrl)
      || (a.price ?? 1e12) - (b.price ?? 1e12));

    const rows = await query<any>(
      `SELECT c.code, c.platform, c.discount_kind, c.discount_value::float AS value, c.discount_cap::float AS cap,
              c.min_purchase::float AS min, c.conditions, c.last_seen_at, pc.confidence,
              (SELECT array_agg(DISTINCT cs.creator) FROM (SELECT creator FROM coupon_sightings
                WHERE coupon_id = c.id AND creator IS NOT NULL ORDER BY seen_at DESC LIMIT 3) cs) AS seen_at
       FROM product_coupons pc JOIN coupons c ON c.id = pc.coupon_id
       WHERE pc.product_id = $1 AND pc.applies AND pc.confidence >= $3 AND c.last_seen_at > now() - make_interval(days => $2)`,
      [s.product_id, HOT_DAYS, MIN_CONFIDENCE]);

    const cheapest = new Map<string, AffiliateLinkView>();
    for (const l of affiliateLinks) {
      const cur = cheapest.get(l.platform);
      if (l.price && (!cur || !cur.price || l.price < cur.price)) cheapest.set(l.platform, l);
      else if (!cur) cheapest.set(l.platform, l);
    }
    // Sem preço do produto na plataforma do cupom: estima o % efetivo pelo preço da página/outra loja
    const pagePrice: number | null = s.page?.price ?? affiliateLinks.find((l) => l.price)?.price ?? null;
    const coupons: CouponView[] = rows.flatMap((r) => {
      const terms = { kind: r.discount_kind, value: r.value, cap: r.cap, min: r.min };
      const listing = cheapest.get(r.platform);
      const base = listing?.price ?? pagePrice;
      let effective: number | null = null;
      if (base && terms.kind) {
        const fp = finalPrice(base, terms);
        if (fp.price === null && listing?.price) return []; // não se aplica ao preço desta plataforma (ex.: mínimo maior)
        if (fp.price !== null) effective = Math.round(((base - fp.price) / base) * 1000) / 10;
        if (effective !== null && effective < 0.5) return []; // efeito desprezível no produto
      }
      return [{
        code: r.code,
        platform: r.platform,
        discountLabel: discountLabel(terms),
        effectivePercent: effective,
        effectiveIsEstimate: effective !== null && !listing?.price,
        nominalPercent: terms.kind === "percent" ? terms.value : null,
        samePlatformAsPage: Boolean(originRef && originRef.platform === r.platform),
        conditions: r.conditions,
        confidence: Math.round(r.confidence * 100) / 100,
        lastSeenAt: new Date(r.last_seen_at).toISOString(),
        seenAt: r.seen_at ?? [],
        buyUrl: listing?.affiliateUrl ?? null,
      }];
    });
    // Melhor primeiro: confiança × desconto × "quentura" (decai em ~3 dias)
    const score = (c: CouponView) => c.confidence * (c.effectivePercent ?? c.nominalPercent ?? 3)
      * Math.exp(-(Date.now() - Date.parse(c.lastSeenAt)) / (72 * 3600_000));
    // Cupons da loja que o usuário está vendo primeiro
    coupons.sort((a, b) => Number(b.samePlatformAsPage) - Number(a.samePlatformAsPage) || score(b) - score(a));

    const sources = await query<any>("SELECT source, status, items, detail FROM source_runs WHERE search_id = $1 ORDER BY source", [searchId]);
    return {
      id: s.id,
      status: s.status,
      mode: s.mode,
      originUrl,
      product: s.product_id ? { id: s.product_id, name: s.product_name } : null,
      coupons: coupons.slice(0, 20),
      affiliateLinks,
      progress: { pendingBatches: s.pending, sources },
      createdAt: new Date(s.created_at).toISOString(),
      finishedAt: s.finished_at ? new Date(s.finished_at).toISOString() : null,
    };
  }
}
