/** Regressão: cada caso aqui foi um erro real observado no POC. */
import { describe, expect, it } from "vitest";
import {
  brlAmounts, canonicalKey, codeCategory, couponForOtherModel, credentialsFromEnv, discountLabel, finalPrice, isCode, modelConflict, offCategory,
  ourLink, parseTerms, platformOf, productMismatch, productOf, sameProduct, scopeFromText, expiredByCode, categoryRule, titleMatches, SELECTED, termsNearCode, verifiedRestriction,
} from "../src";

describe("parseTerms", () => {
  it("lê teto 'Limite de' e mínimo 'OFF em' (AQUITEMTECH saía 10% em vez de 3,5%)", () => {
    expect(parseTerms("🎟 10% OFF em R$149, Limite de R$ 200 OFF: AQUITEMTECH")).toEqual({ kind: "percent", value: 10, cap: 200, min: 149 });
  });
  it("não confunde R$ 3000 com R$ 300", () => {
    expect(parseTerms("Economize até R$ 300 ao usar o código (acima de R$ 3000).")).toEqual({ kind: "fixed", value: 300, cap: null, min: 3000 });
  });
  it("lê teto entre parênteses", () => {
    expect(parseTerms("Economize até 15% no carrinho (até R$ 59).").cap).toBe(59);
  });
  it("valores com milhar e centavos", () => {
    expect(brlAmounts("De R$ 6.499 por R$ 5.899,90")).toEqual([6499, 5899.9]);
  });
});

describe("termsNearCode", () => {
  const post = "➡️ 30% OFF sem compra mínima, limitado a R$500 OFF\n🎟 CUPOM: ECONOMIZE\n\n➡️ 20% OFF acima de R$ 99, limitado a R$100\n🎟 CUPOM: QUEROOFF";
  it("termos na linha anterior ao código", () => {
    expect(termsNearCode(post, "ECONOMIZE")).toEqual({ kind: "percent", value: 30, cap: 500, min: null });
    expect(termsNearCode(post, "QUEROOFF")).toEqual({ kind: "percent", value: 20, cap: 100, min: 99 });
  });
});

describe("preço final e rótulo", () => {
  it("aplica teto", () => expect(finalPrice(4000, { kind: "percent", value: 20, cap: 500, min: 1 }).price).toBe(3500));
  it("respeita compra mínima", () => expect(finalPrice(2500, { kind: "fixed", value: 300, cap: null, min: 3000 }).price).toBeNull());
  it("rótulo mostra teto e mínimo", () => expect(discountLabel({ kind: "percent", value: 10, cap: 200, min: 149 })).toBe("10% até R$200 mín R$149"));
});

describe("códigos", () => {
  it("rejeita o que não é código", () => {
    expect(["Santander", "cupom-amazon", "Resgate no link", "cupom"].map(isCode)).toEqual([false, false, false, false]);
    expect(["PRIME10", "MELI-10", "cris10", "GVSL"].map(isCode)).toEqual([true, true, true, true]);
  });
  it("categoria no nome do código", () => {
    expect(codeCategory("CASA3010")).toBeTruthy();
    expect(codeCategory("BEBES3010")).toBeTruthy();
    expect(codeCategory("SITE2810TODO")).toBeNull();
    expect(codeCategory("AQUITEMTECH")).toBeNull();
  });
  it("pré-filtro de categoria com acento", () => {
    expect(offCategory("Cupom válido para bebês selecionados")).toBeTruthy();
    expect(offCategory("10% OFF em eletrônicos")).toBeNull();
  });
  it("restrição precisa existir no texto", () => {
    expect(verifiedRestriction("site todo", "Cupom geral")).toBe("");
    expect(verifiedRestriction("memory modules", "FONTES SELECIONADAS")).toBe("?");
    expect(verifiedRestriction("gabinetes", "15% OFF em gabinetes selecionados")).toBe("gabinetes");
  });
});

describe("produto e modelo", () => {
  it("TV de 50 não é a de 75; preço da TV não vai para o iPhone", () => {
    expect(productMismatch("TV Samsung 4K 75 polegadas", 'Smart TV Samsung 50" 4K por R$ 1.847')).toMatch(/75/);
    expect(productMismatch("Iphone 17", "Smart TV Samsung 75 4K por R$ 5.899")).toMatch(/17/);
    expect(productMismatch("Iphone 17", "iPhone 17 256GB por R$ 5.899")).toBeNull();
  });
  it("17e e 17 Pro são outros modelos; PS5 Slim é o PS5", () => {
    expect(productMismatch("Iphone 17", "iPhone 17e 256GB")).toMatch(/17/);
    expect(modelConflict("Iphone 17", "iPhone 17 Pro Max")).toMatch(/pro/);
    expect(modelConflict("Play Station 5", "Console PS5 Slim")).toBeNull();
    expect(modelConflict("Play Station 5", "PS5 Pro")).toMatch(/pro/);
  });
  it("mesmo produto com nomes diferentes; versões diferentes não", () => {
    expect(sameProduct("Apple iPhone 17 256GB", "iphone 17 de 256 gb da apple")).toBe(true);
    expect(sameProduct("Apple iPhone 17 256GB", "iPhone 17 Pro 256GB")).toBe(false);
    expect(sameProduct("Apple iPhone 17 256GB", "iPhone 17 512GB")).toBe(false);
    expect(sameProduct("Fritadeira Air Fryer Philco 15L", "Fritadeira Air Fryer Mondial 4L")).toBe(false);
    expect(sameProduct("Air Fryer Philco 4L", "Air Fryer Mondial 4L")).toBe(false);
    expect(sameProduct("iPhone 18 Pro Max 512GB Bordô - Distribuidor Autorizado", "iPhone 18 Pro Max 512GB Bordô")).toBe(true);
  });
  it("cupom geral vale para modelo com qualificador; cupom de outro modelo não", () => {
    expect(couponForOtherModel("Apple iPhone 17 Pro 256GB", "🎟 10% OFF em R$149, Limite de R$ 200: AQUITEMTECH")).toBeNull();
    expect(couponForOtherModel("Apple iPhone 17 Pro 256GB", "iPhone 17 Pro Max por R$ 9.999 com cupom COMPRAS")).toMatch(/max/);
    expect(couponForOtherModel("Iphone 17", "https://www.kabum.com.br/produto/925352/iphone-17-pro-apple-1tb")).toMatch(/pro/);
  });
  it("chave canônica junta grafias", () => {
    expect(canonicalKey("Play Station 5")).toBe(canonicalKey("playstation 5"));
    expect(canonicalKey("PS5")).toBe(canonicalKey("PlayStation 5"));
  });
});

describe("plataformas e links", () => {
  it("reconhece por domínio e encurtador; rejeita loja estrangeira", () => {
    expect(platformOf(null, "https://s.shopee.com.br/3qO4")).toBe("Shopee");
    expect(platformOf("?", "https://meli.la/1Zr")).toBe("Mercado Livre");
    expect(platformOf(null, "https://www.amazon.in/dp/X")).toBeNull();
    expect(platformOf("GVGmall", null)).toBeNull();
  });
  it("extrai o produto sem o rastreio de terceiros", () => {
    expect(productOf("https://www.amazon.com.br/dp/B0BYZJWDNC/ref=cm_sw?tag=moneytorando-20")?.url).toBe("https://www.amazon.com.br/dp/B0BYZJWDNC");
    expect(productOf("https://shopee.com.br/opaanlp/1542149313/55116935739?x=1")?.externalId).toBe("1542149313/55116935739");
    expect(productOf("https://www.mercadolivre.com.br/social/audax?matt_word=iuriindica")).toBeNull();
    expect(productOf("https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F925352%2Fx")?.platform).toBe("KaBuM!");
  });
  it("monta o NOSSO link só com as nossas credenciais", () => {
    const ref = productOf("https://www.amazon.com.br/dp/B0BYZJWDNC?tag=outro-20")!;
    expect(ourLink(ref, {}).url).toBeNull();
    expect(ourLink(ref, { amazonTag: "nosso-20" }).url).toBe("https://www.amazon.com.br/dp/B0BYZJWDNC?tag=nosso-20");
    const ml = productOf("https://www.mercadolivre.com.br/p/MLB66130045?matt_tool=38524122")!;
    expect(ourLink(ml, credentialsFromEnv({ ML_AFFILIATE_WORD: "w", ML_AFFILIATE_TOOL: "1" })).url)
      .toBe("https://www.mercadolivre.com.br/p/MLB66130045?matt_word=w&matt_tool=1");
  });
  it("escopo escrito no cupom de loja (agregadores)", () => {
    expect(scopeFromText("Cupom Mercado Livre - R$45 OFF acima de R$299 · Em itens Auto ..")).toBe("auto");
    expect(scopeFromText("20% OFF, máximo R$ 50, em R$ 99 em Itens de Limpeza")).toBe("limpeza");
    expect(scopeFromText("Cupom Mercado Livre oferece R$ 20 em R$ 149 em Pet Shop")).toBe("pet shop");
    expect(scopeFromText("35% OFF em itens Colgate acima de R$ 199")).toBe("colgate");
    expect(scopeFromText("CUPOM 25% OFF, Limite de R$ 500 OFF · 25% OFF em R$ 1")).toBeNull();
    expect(scopeFromText("Economize R$ 40 ao usar o código promocional no carrinho de compras (acima de R$ 199).")).toBeNull();
    expect(scopeFromText("20% OFF limitado à R$50 em Lojas Oficiais")).toBeNull(); // "selecionados" (SELECTED)
  });
  it("código com data expira depois do dia", () => {
    const now = new Date(2026, 9, 30, 15, 0);
    expect(expiredByCode("TODOSITE2810", now)).toBe(true);
    expect(expiredByCode("SITE3010", now)).toBe(false);
    expect(expiredByCode("MELIMAIS2610", now)).toBe(true);
    expect(expiredByCode("SITEMELIMAIS15", now)).toBe(false);
    expect(expiredByCode("MUNDOAUTO45", now)).toBe(false);
    expect(expiredByCode("NATAL2512", now)).toBe(false);
  });
  it("celular não está em eletrônicos", () => {
    expect(categoryRule("Apple iPhone 17 256GB", "eletrônicos")).toBe(false);
    expect(categoryRule("Samsung Galaxy S25 Ultra", "tecnologia")).toBe(false);
    expect(categoryRule("Apple iPhone 17 256GB", "celulares")).toBeNull();
    expect(categoryRule("Fritadeira Air Fryer Philco 15L", "eletrônicos")).toBeNull();
  });
  it("título de oferta do mesmo produto", () => {
    expect(titleMatches("Basike Fone de Ouvido Bluetooth Clip-on", "Fone de Ouvido Bluetooth JBL Tune 520")).toBe(false);
    expect(titleMatches("iPhone 18 Pro Max 512GB Bordô", "Apple iPhone 18 Pro Max 512GB")).toBe(true);
    expect(titleMatches("Fritadeira Air Fryer Philco 15L", "Fritadeira Air Fryer Philco 15L 127V/220V")).toBe(true);
    expect(titleMatches("Fritadeira Air Fryer Philco 15L", "Air Fryer Oven Philco 16L Digital")).toBe(false);
  });
  it("cupom de combo/itens qualificados não vale para um produto avulso", () => {
    expect(SELECTED.test("[Prime] Leve 3 itens da Lista e ganhe 15% OFF na Amazon · Sobre 1000 itens qualificados")).toBe(true);
    expect(SELECTED.test("Itens perto do Vencimento com 20% OFF · Seleção de itens")).toBe(true);
    expect(SELECTED.test("Exclusivo Prime: 40% off · Cupom Amazon: OUTLETPRIME")).toBe(true);
    expect(SELECTED.test("[Meli+] Cupom Mercado Livre - 15% OFF acima de R$249")).toBe(true);
    expect(SELECTED.test("Cupom Mercado Livre oferece R$ 150 OFF em R$ 1099 · DIZ SER TODO O SITE")).toBe(false);
    expect(SELECTED.test("CUPOM 25% OFF, Limite de R$ 500 OFF")).toBe(false);
  });
});
