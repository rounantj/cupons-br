-- Cupons BR: schema inicial. Roda dentro do schema da aplicação (DB_SCHEMA, padrão "cupons"):
-- o migrate.ts cria o schema, a extensão vector (no public) e ajusta o search_path antes deste arquivo.
-- gen_random_uuid() é nativo desde o Postgres 13.

-- Produto catalogado. Um produto = um item comprável (ex.: "iPhone 17 256GB"), encontrado em várias plataformas.
CREATE TABLE products (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  canonical_key         text NOT NULL UNIQUE,         -- nome normalizado (busca exata)
  brand                 text,
  gtin                  text,
  embedding             vector(1536),                 -- nome do produto (reconhece "PS5" = "PlayStation 5")
  catalogued_at         timestamptz,                  -- última busca completa (páginas + links + cupons)
  coupons_refreshed_at  timestamptz,                  -- último reaquecimento de cupons
  search_count          int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_embedding_idx ON products USING hnsw (embedding vector_cosine_ops);
CREATE INDEX products_gtin_idx ON products (gtin) WHERE gtin IS NOT NULL;

-- Página do produto em cada plataforma + NOSSO link de afiliado
CREATE TABLE listings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  platform      text NOT NULL,
  external_id   text NOT NULL,                        -- ASIN, MLB..., shopid/itemid, SKU
  url           text NOT NULL,                        -- página canônica, sem rastreio de terceiros
  title         text,
  price         numeric(12,2),
  price_seen_at timestamptz,
  affiliate_url text,                                 -- gerado com as nossas credenciais
  source        text NOT NULL,                        -- origin_page | youtube | telegram
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);
CREATE INDEX listings_product_idx ON listings (product_id);

-- Cupom (um por plataforma + código). Regras completas ficam aqui; cada aparição vira um sighting.
CREATE TABLE coupons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        text NOT NULL,
  code            text NOT NULL,
  code_norm       text GENERATED ALWAYS AS (lower(code)) STORED,
  discount_kind   text,                               -- percent | fixed
  discount_value  numeric(12,2),
  discount_cap    numeric(12,2),
  min_purchase    numeric(12,2),
  restricted_to   text,                               -- categoria/produto a que se restringe (null = site todo)
  conditions      text,
  terms_text      text,                               -- trecho original com as regras
  embedding       vector(1536),                       -- regras + restrição (reaproveitar em produtos parecidos)
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, code_norm)
);
CREATE INDEX coupons_hot_idx ON coupons (last_seen_at DESC);
CREATE INDEX coupons_embedding_idx ON coupons USING hnsw (embedding vector_cosine_ops);

-- Onde o cupom foi visto (prova + "quentura"). Crédito ao criador é texto, nunca link de afiliado de terceiros.
CREATE TABLE coupon_sightings (
  id            bigserial PRIMARY KEY,
  coupon_id     uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  source        text NOT NULL,                        -- youtube | telegram
  source_url    text NOT NULL,
  creator       text,
  published_at  timestamptz,
  seen_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, source_url)
);
CREATE INDEX coupon_sightings_coupon_idx ON coupon_sightings (coupon_id, seen_at DESC);

-- Avaliação do cupom para um produto
CREATE TABLE product_coupons (
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  coupon_id         uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  applies           boolean NOT NULL,
  confidence        real NOT NULL,
  reason            text,
  evaluated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, coupon_id)
);

-- Busca (uma por requisição). O GET acompanha status até "done".
CREATE TABLE searches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  query         text NOT NULL,
  page          jsonb,                                -- contexto enviado pela extensão
  mode          text NOT NULL,                        -- full | refresh | cached
  status        text NOT NULL DEFAULT 'queued',       -- queued | collecting | analyzing | linking | done | failed
  pending       int NOT NULL DEFAULT 0,               -- lotes de análise ainda na fila
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX searches_product_idx ON searches (product_id, created_at DESC);

CREATE TABLE source_runs (
  search_id   uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  source      text NOT NULL,
  status      text NOT NULL,
  items       int NOT NULL DEFAULT 0,
  duration_ms int NOT NULL DEFAULT 0,
  detail      text,
  PRIMARY KEY (search_id, source)
);

-- Fontes
CREATE TABLE youtube_channels (
  channel_id        text PRIMARY KEY,
  title             text NOT NULL,
  uploads_playlist  text,
  videos_seen       int NOT NULL DEFAULT 0,
  coupon_hits       int NOT NULL DEFAULT 0,
  last_hit_at       timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE youtube_quota (
  day    date PRIMARY KEY,
  units  int NOT NULL DEFAULT 0
);

CREATE TABLE telegram_channels (
  username        text PRIMARY KEY,
  title           text,
  discovered_from text,
  is_br           boolean,
  posts_seen      int NOT NULL DEFAULT 0,
  coupon_hits     int NOT NULL DEFAULT 0,
  last_post_at    timestamptz,
  last_checked_at timestamptz,
  first_seen_at   timestamptz NOT NULL DEFAULT now()
);
-- Canais brasileiros de cupons verificados no POC (posts diários em R$)
INSERT INTO telegram_channels (username, discovered_from) VALUES
  ('reidoscupons', 'seed'), ('promoindicabr', 'seed'), ('iuriindica', 'seed'), ('cacadoresofertas', 'seed'),
  ('ofertasdovinialbergoni', 'seed'), ('mastertechjr', 'seed'), ('canalrodrigomoreira', 'seed'), ('promocoesrod', 'seed');

-- Cache genérico (substitui Redis). UNLOGGED: sem WAL, mais rápido; conteúdo pode sumir num crash.
CREATE UNLOGGED TABLE cache (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX cache_expires_idx ON cache (expires_at);
