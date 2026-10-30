# Uma imagem para API, worker e migração (o comando muda por serviço)
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY apps/extension/package.json apps/extension/package.json
RUN pnpm install --frozen-lockfile --filter "!@cupons/extension" && pnpm build:server
# só dependências de produção na imagem final
RUN rm -rf node_modules packages/*/node_modules apps/*/node_modules && \
    CI=true pnpm install --frozen-lockfile --prod --filter "!@cupons/extension"

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
USER node
CMD ["node", "apps/api/dist/main.js"]
