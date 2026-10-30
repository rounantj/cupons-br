# Cupons BR

Numa única busca por produto: **cupons quentes com o % de desconto real** e **os nossos links de afiliado** do mesmo
produto. A extensão de navegador detecta o produto que o usuário está vendo e mostra o resultado numa notificação
discreta.

```
apps/api         NestJS · POST /v1/searches (enfileira ou responde do cache) · GET /v1/searches/:id
apps/worker      consumidores da fila: coleta (YouTube + Telegram) → análise IA → links afiliados
apps/extension   MV3 (Chrome/Edge/Opera + Firefox) · React · notificação em shadow DOM
packages/db      Postgres + pgvector (schema próprio), cache em tabela UNLOGGED, fila pg-boss, migrations
packages/core    regras: termos do cupom, % efetivo, plataforma, mesmo produto/modelo, nosso link afiliado
packages/sources YouTube Data API, Telegram (t.me/s), resolução de links, Shopee Affiliate API
packages/ai      OpenAI (extração com JSON estrito + embeddings)
infra/           Dockerfile, Terraform (DigitalOcean), assets
store/           ficha da loja, capturas, banners · PRIVACY.md
```

## Decisões

- **Fila no Postgres (pg-boss)**, não BullMQ: BullMQ exige Redis (custo extra). pg-boss tem retentativa, agendamento e
  concorrência, no schema `cupons_queue`.
- **Cache no Postgres**: tabela `UNLOGGED` (`cupons.cache`) para respostas de APIs externas; produto catalogado é
  reaproveitado e só os cupons são reaquecidos (`PRODUCT_TTL_HOURS`, `COUPON_TTL_MINUTES`).
- **Banco compartilhado**: tudo em `DB_SCHEMA` (padrão `cupons`); nada no `public`. Use conexão direta ou pool em modo
  *session* (o `search_path` é parâmetro de sessão).
- **Vetor (`vector(1536)`)**: o embedding do nome sugere candidatos ("PS5" ≈ "PlayStation 5"); a regra confirma número e
  versão do modelo ("iPhone 17" ≠ "iPhone 17 Pro"). Produtos novos herdam cupons quentes de produtos parecidos.
- **IA extrai, código decide**: a IA lê posts/vídeos; teto, mínimo, categoria, modelo e % efetivo são regras
  determinísticas com testes de regressão (`packages/core/test`).

## Rodar local (custo zero)

```bash
cp .env.example .env            # OPENAI_API_KEY, YOUTUBE_API_KEY, credenciais de afiliado
pnpm install && pnpm build:server
docker compose up -d --build    # postgres+pgvector, migrate, api (:3000), worker
node scripts/e2e.mjs "Apple iPhone 17 256GB" "https://www.amazon.com.br/dp/<ASIN>" 7999
ngrok http 3000                 # URL pública para a extensão
VITE_API_URL=https://<seu-dominio>.ngrok-free.dev pnpm --filter @cupons/extension build
```

Carregar a extensão: `chrome://extensions` → modo desenvolvedor → "Carregar sem compactação" → `apps/extension/dist/chrome`.

## Produção (DigitalOcean, mais barato)

`infra/terraform`: 1 droplet (~US$ 6/mês) com API + worker + Caddy (HTTPS automático), imagens do GHCR (CI), banco
externo via `DATABASE_URL`.

```bash
cd infra/terraform && export TF_VAR_do_token=... TF_VAR_app_env="$(cat ../../.env.production)"
terraform init && terraform apply
```

## Testes

`pnpm test` (regras) · `node scripts/e2e.mjs` (pipeline completo) · extensão testada em página real com Chrome for Testing.
