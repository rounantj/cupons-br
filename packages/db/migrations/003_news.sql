-- Segunda extensão (notícias): matérias indexadas dos feeds/Google News + a página do leitor, com vetor do título.
-- A busca de "mesma notícia" é por vizinhança no vetor (pgvector) dentro de uma janela de dias.
CREATE TABLE news_articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url           text NOT NULL UNIQUE,
  domain        text NOT NULL,                 -- g1.globo.com
  site          text NOT NULL,                 -- g1
  title         text NOT NULL,
  description   text,
  body          text,                          -- começo da matéria (lido sob demanda para a análise)
  published_at  timestamptz,
  via_google    boolean NOT NULL DEFAULT false,
  embedding     vector(1536),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_articles_embedding_idx ON news_articles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX news_articles_published_idx ON news_articles (published_at DESC);

CREATE TABLE news_lookups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id   uuid NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'queued',  -- queued | collecting | analyzing | done | failed
  related      jsonb NOT NULL DEFAULT '[]',     -- [{id, similarity}] na ordem de exibição
  analysis     jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX news_lookups_article_idx ON news_lookups (article_id, created_at DESC);
