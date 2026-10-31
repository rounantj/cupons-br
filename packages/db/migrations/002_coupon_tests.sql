-- Resultado de cupons testados no checkout real (extensão, sessão do próprio usuário).
-- É a única prova de que um cupom funciona: a notificação só mostra cupom com teste "works" recente.
-- Sem dado pessoal: nem usuário, nem carrinho; só produto, código, resultado e a mensagem da loja.
CREATE TABLE coupon_tests (
  id          bigserial PRIMARY KEY,
  product_id  uuid REFERENCES products(id) ON DELETE CASCADE,  -- produto que estava no carrinho (pode faltar)
  platform    text NOT NULL,
  code        text NOT NULL,
  code_norm   text GENERATED ALWAYS AS (lower(code)) STORED,
  result      text NOT NULL,      -- works | not_applicable | expired | invalid | unknown
  message     text,               -- texto da loja ("não se aplica a esta compra"), para refinar a classificação
  tested_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coupon_tests_product_idx ON coupon_tests (product_id, tested_at DESC);
CREATE INDEX coupon_tests_code_idx ON coupon_tests (platform, code_norm, tested_at DESC);
