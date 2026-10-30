// Teste ponta a ponta: simula a extensão numa página de produto, acompanha até "done" e imprime as duas listas.
// node scripts/e2e.mjs "Apple iPhone 17 256GB" https://www.amazon.com.br/dp/B0FQHXYK1Y 7999
const API = process.env.API_URL ?? "http://localhost:3000";
const [name, url, price] = process.argv.slice(2);
const headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
const t0 = Date.now();
let s = await (await fetch(`${API}/v1/searches`, { method: "POST", headers,
  body: JSON.stringify({ page: { url, productName: name, price: price ? Number(price) : undefined, currency: "BRL" } }) })).json();
console.log(`busca ${s.id} · modo=${s.mode} · produto="${s.product?.name}"`);
let last = "";
while (!["done", "failed"].includes(s.status)) {
  await new Promise((r) => setTimeout(r, 2000));
  s = await (await fetch(`${API}/v1/searches/${s.id}`, { headers })).json();
  const st = `${s.status} (lotes pendentes: ${s.progress.pendingBatches})`;
  if (st !== last) console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${st}`), (last = st);
}
console.log(`\n=== ${s.status.toUpperCase()} em ${((Date.now() - t0) / 1000).toFixed(1)}s ===`);
for (const r of s.progress.sources) console.log(`  ${r.source.padEnd(17)} ${r.status.padEnd(7)} ${String(r.items).padStart(3)}  ${r.detail ?? ""}`);
console.log(`\n1) CUPONS (${s.coupons.length})`);
for (const c of s.coupons.slice(0, 12))
  console.log(`  ${c.code.padEnd(16)} ${(c.effectivePercent != null ? c.effectivePercent + "% efetivo" : c.discountLabel ?? "—").padEnd(24)} ${c.platform.padEnd(14)} conf ${Math.round(c.confidence * 100)}%  visto: ${c.seenAt.join(", ")}`);
console.log(`\n2) LINKS AFILIADOS (${s.affiliateLinks.length})`);
for (const l of s.affiliateLinks.slice(0, 10))
  console.log(`  ${l.isOriginPage ? "★" : " "} ${l.platform.padEnd(14)} ${l.price ? "R$ " + l.price : "—"}  ${l.affiliateUrl ?? "(sem link nosso: " + l.missing + ")"}  ${l.productUrl}`);
if (s.status === "failed") console.log("ERRO:", s.error);
