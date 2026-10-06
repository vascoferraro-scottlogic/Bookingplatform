# syntax=docker/dockerfile:1

# ---- deps: install all dependencies (incl. dev) for the build ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Schema must be present before `npm ci` (postinstall runs `prisma generate`).
# .npmrc carries legacy-peer-deps=true — required for ts-jest vs typescript 6.
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN npm ci

# ---- builder: generate the Prisma client + build the standalone server ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Release id — the Docker context has no .git, so next.config reads this arg.
ARG APP_VERSION=1.0.0-docker
ENV APP_VERSION=$APP_VERSION
# prisma.config.ts resolves env("DATABASE_URL") at load time, and `prisma
# generate` / `next build` only need it to be *present*, not live. compose's
# environment block overrides this with the real URL when app-migrate runs.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# ---- runner: slim runtime serving the standalone output ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server + static assets + runtime content (i18n messages, help).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/content ./content
# Guarantee the Prisma client + engine are present (belt & braces over nft).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
