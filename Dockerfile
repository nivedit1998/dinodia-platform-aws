FROM node:20-bookworm-slim AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
#
# Prisma runs during `npm ci` via the repo's `postinstall` script (`prisma generate`).
# Prisma doesn't need a real DB connection to generate the client, but it *does* require
# DATABASE_URL to be set so config/schema validation passes.
#
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
ENV DIRECT_URL="postgresql://user:pass@localhost:5432/db?schema=public"
#
# Next.js build evaluates some server modules (including route handlers). The app enforces
# certain env vars at module import time; provide safe placeholders for build-time.
#
ENV JWT_SECRET="build-placeholder-jwt-secret"
ENV PLATFORM_DATA_ENCRYPTION_KEY="build-placeholder-platform-data-encryption-key"
ENV NEXT_PUBLIC_APP_URL="http://localhost:3000"

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
ENV DIRECT_URL="postgresql://user:pass@localhost:5432/db?schema=public"
ENV JWT_SECRET="build-placeholder-jwt-secret"
ENV PLATFORM_DATA_ENCRYPTION_KEY="build-placeholder-platform-data-encryption-key"
ENV NEXT_PUBLIC_APP_URL="http://localhost:3000"

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["npm", "run", "start", "--", "-p", "3000", "-H", "0.0.0.0"]
