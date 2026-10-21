# FIN-108 — imagem do FinFlow: a API serve também o build do frontend, na mesma origem.
# Uso: `docker compose up -d --build` (ver README, "Rodando com Docker").

FROM node:22-bookworm-slim AS base
# O motor de migrações do Prisma é um binário que precisa da OpenSSL, ausente na imagem slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
# Dependências antes do código, para o cache desta etapa sobreviver às mudanças nele. O `postinstall`
# (prisma generate) lê o schema.
COPY package.json package-lock.json prisma.config.ts ./
COPY Backend/prisma ./Backend/prisma
RUN npm ci
COPY . .
# Vazia, o frontend chama a API da própria origem (Frontend/src/services/api.ts).
ENV VITE_API_URL=""
RUN npm run build && npm prune --omit=dev

FROM base
ENV NODE_ENV=production \
    FRONTEND_DIR=/app/Frontend/dist \
    DATABASE_URL=file:/data/finflow.db
# Pastas do banco e dos backups com dono `node`: um volume novo herda o dono.
RUN mkdir -p /data /backups && chown node:node /data /backups
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/Frontend/dist ./Frontend/dist
COPY package.json prisma.config.ts ./
COPY Backend/server.js ./Backend/
COPY Backend/server ./Backend/server
COPY Backend/prisma ./Backend/prisma
COPY Backend/scripts/backup-db.mjs ./Backend/scripts/
USER node
EXPOSE 3001
# Aplica as migrações pendentes (FIN-020) e sobe a API; com `exec`, o node recebe o sinal de parada.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node Backend/server.js"]
