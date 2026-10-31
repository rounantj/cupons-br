/** Prompts validados no POC: a IA EXTRAI regras e preços; quem decide aplicar e calcula o % é o código. */

export const CREATOR_SYSTEM = `Você lê conteúdos de influenciadores de ofertas — vídeos do YouTube (título, trechos da descrição,
comentários) ou posts de canais de ofertas do Telegram — e extrai o que serve para comprar o PRODUTO mais barato.
Cupons gerais de uma plataforma (ex.: "Cupom Mercado Livre 10% OFF a partir de R$ 79: CODIGO") também servem para o
PRODUTO se não forem restritos a outra categoria. Para cada conteúdo [i], crie itens (mesmo i):
- type="coupon": um item para CADA código de cupom escrito no texto ou nos comentários, com a loja.
  restricted_to = categoria/produto a que o cupom se restringe, COPIANDO as palavras do texto ("" se vale para o site todo);
  selected_items, freight_only, kind ("percent"|"fixed"|"none"), value, cap (desconto máximo R$), min (compra mínima R$),
  conditions (ex.: "só no app", "1 por CPF", "Meli+"; "" se nenhuma).
  Se o texto anuncia o PRODUTO junto com esse cupom: price = preço final anunciado em R$, original_price = preço "de",
  url = link do produto/loja exatamente como no texto. Caso contrário price, original_price e url = null.
- type="price": quando o texto cita um PREÇO para o PRODUTO pedido sem código (ex.: "iPhone 17 por R$ 5.899 no link").
  price, original_price, store, url (exatamente como no texto, ou null).
product_match = true só se o item é o PRÓPRIO produto pedido (não acessório, jogo, capa ou outro modelo/versão);
para cupom geral de plataforma, product_match = true.
comment_signal: "works" | "fails" | "mixed" | "none" conforme os comentários sobre aquele item.
Comentários marcados [CRIADOR] são do dono do canal. Não crie itens sem código ou preço explícito.
Não invente códigos, preços ou links.`;

const nullableNumber = { type: ["number", "null"] };
export const CREATOR_SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["i", "type", "code", "store", "product_match", "price", "original_price", "url", "restricted_to",
          "selected_items", "freight_only", "kind", "value", "cap", "min", "conditions", "comment_signal"],
        properties: {
          i: { type: "integer" },
          type: { type: "string", enum: ["coupon", "price"] },
          code: { type: ["string", "null"] },
          store: { type: ["string", "null"] },
          product_match: { type: "boolean" },
          price: nullableNumber,
          original_price: nullableNumber,
          url: { type: ["string", "null"] },
          restricted_to: { type: "string" },
          selected_items: { type: "boolean" },
          freight_only: { type: "boolean" },
          kind: { type: "string", enum: ["percent", "fixed", "none"] },
          value: nullableNumber,
          cap: nullableNumber,
          min: nullableNumber,
          conditions: { type: "string" },
          comment_signal: { type: "string", enum: ["works", "fails", "mixed", "none"] },
        },
      },
    },
  },
};

export interface CreatorItem {
  i: number;
  type: "coupon" | "price";
  code: string | null;
  store: string | null;
  product_match: boolean;
  price: number | null;
  original_price: number | null;
  url: string | null;
  restricted_to: string;
  selected_items: boolean;
  freight_only: boolean;
  kind: "percent" | "fixed" | "none";
  value: number | null;
  cap: number | null;
  min: number | null;
  conditions: string;
  comment_signal: "works" | "fails" | "mixed" | "none";
}

/** Pergunta binária isolada por categoria: modelos pequenos acertam isso, erram quando misturado à extração. */
export const FIT_SYSTEM = `Para cada categoria, responda se o PRODUTO pertence a ela (o cupom da categoria valeria para o produto).
Seja literal e estrito; na dúvida, responda false.
Exemplo para um console de videogame: pertence a "eletrônicos", "games", "consoles", "tecnologia";
NÃO pertence a "gabinetes", "processadores", "fontes", "notebooks", "casa conectada", "áudio", "celulares",
nem a um produto específico diferente.
Siga a árvore de categorias das lojas brasileiras (Mercado Livre, Amazon): "Celulares e Telefones" é categoria própria,
então celular/smartphone NÃO pertence a "eletrônicos" (nem a "tecnologia", "informática", "áudio e vídeo");
"Informática" (notebooks, PCs, periféricos) também não está em "eletrônicos"; eletrodomésticos/eletroportáteis
(air fryer, liquidificador, geladeira) NÃO são "eletrônicos".`;

export const FIT_SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: { type: "object", required: ["category", "fits"], properties: { category: { type: "string" }, fits: { type: "boolean" } } },
    },
  },
};
