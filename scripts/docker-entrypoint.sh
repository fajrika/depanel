#!/bin/sh
set -e

# Ensure the SQLite data directory exists (mount a persistent volume here).
mkdir -p /app/data

# Apply the schema to the database on every boot (idempotent, additive changes only).
# Uses the isolated Prisma CLI so the app's node_modules can stay lean.
# Backfill destPath from destConfig BEFORE db push drops the column.
echo "→ Backfilling job destinations from destConfig..."
node scripts/backfill-destpath.cjs

echo "→ Syncing database schema..."
node /opt/prisma/node_modules/prisma/build/index.js db push \
  --schema=/app/prisma/schema.prisma --skip-generate --accept-data-loss

# Seed a default admin on the very first boot (no-op once any user exists).
node dist/seed.cjs

# Launch web + worker.
exec node scripts/docker-start.mjs
