# ============================================================
# Dockerfile — Skicenter Platform
# Build multi-stage: compila cliente Vite + servidor Node.js
# ============================================================

# ─── Etapa 1: Build ───────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Instalar pnpm (versión fijada = misma que el lockfile local)
RUN npm install -g pnpm@10.32.1

# Copiar manifiestos de dependencias y patches
COPY package.json pnpm-lock.yaml* ./
COPY patches ./patches

# Instalar dependencias (incluyendo devDependencies para el build)
RUN pnpm install --frozen-lockfile

# Copiar todo el código fuente
COPY . .

# Build del cliente Vite y del servidor TypeScript
# NODE_OPTIONS aumenta heap para compilar CRMDashboard (~900 kB chunk)
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm build

# ─── Etapa 2: Producción ──────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Chromium + dependencias de sistema para puppeteer-core (generación de PDFs)
# chromium-browser queda en /usr/bin/chromium-browser (ruta ya declarada en pdfGenerator.ts)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto

# Copiar node_modules y artefactos del builder (evita reinstalar)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY package.json ./

# scripts/ + server/ (fuente TS, no bundleada) — necesarios para poder ejecutar
# `pnpm db:migrate` / `pnpm db:seed` explícitamente dentro de este contenedor
# (vía tsx, ya presente en node_modules). Antes no se copiaban y esos comandos
# no eran ejecutables en producción — ver fase de saneamiento de startup.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/server ./server

# pnpm no estaba disponible en esta etapa (solo en el builder) — necesario
# para poder invocar `pnpm db:migrate`/`pnpm db:seed` dentro del contenedor.
RUN npm install -g pnpm@10.32.1

# Directorio para almacenamiento local de fallback
RUN mkdir -p /tmp/local-storage

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
