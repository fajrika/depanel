# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Depanel — optimized multi-stage Alpine image (web + scheduler worker).
# Web runs from Next.js standalone output (only traced deps); the worker is
# compiled to a single CJS file. The Prisma CLI (needed only for `db push`
# at boot) lives in an isolated dir so the app image stays lean.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
# libc6-compat + openssl are needed by the Prisma engine on Alpine (musl).
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- 1. full deps (for building). npm cache is mounted so re-downloads are skipped. ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- 2. build the app (standalone) + compile the worker ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="file:/tmp/build.db"
RUN npx prisma generate \
  && npm run build \
  && npm run build:server

# ---- 3. runtime Prisma client + musl query engine.
#         Reuse deps' node_modules and just prune devDeps (no second full install). ----
FROM base AS proddeps
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm prune --omit=dev && npx prisma generate

# ---- 4. isolated Prisma CLI (complete dependency closure) for `db push` ----
FROM base AS prismacli
WORKDIR /pcli
RUN --mount=type=cache,target=/root/.npm npm init -y >/dev/null 2>&1 \
  && npm install prisma@6.19.3 --omit=dev --no-audit --no-fund

# ---- 4b. deps for the compiled worker/create-user scripts that Next bundles
#          into its own chunks (so they're absent from node_modules). ----
FROM base AS workerdeps
WORKDIR /wd
RUN --mount=type=cache,target=/root/.npm npm init -y >/dev/null 2>&1 \
  && npm install mysql2@3.22.6 basic-ftp@6.0.1 cron-parser@5.6.1 node-cron@4.6.0 bcryptjs@3.0.3 --omit=dev --no-audit --no-fund

# ---- 5. runner ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone server: /app/server.js + a minimal traced node_modules.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma query engine for the runtime client (standalone traces the JS, not the engine).
COPY --from=proddeps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=proddeps /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Deps Next's tracer missed (needed by both DB-backup routes and the worker).
COPY --from=workerdeps /wd/node_modules ./node_modules

# Scheduler worker (compiled).
COPY --from=builder /app/dist ./dist

# Isolated Prisma CLI (kept out of the app's node_modules).
COPY --from=prismacli /pcli/node_modules /opt/prisma/node_modules

COPY prisma ./prisma
COPY package.json ./package.json
COPY scripts/docker-entrypoint.sh scripts/docker-start.mjs ./scripts/
RUN chmod +x scripts/docker-entrypoint.sh && mkdir -p /app/data

EXPOSE 3000

# Persist the SQLite database across restarts (mount this in Coolify).
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
