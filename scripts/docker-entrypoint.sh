#!/bin/sh
set -e

# Ensure the SQLite data directory exists (mount a persistent volume here).
mkdir -p /app/data

# Backfill the destConfig → destPath refactor across the schema push:
#  - save: cache destPath from destConfig (works on the OLD schema; no-op if the
#    column is already gone).
#  - db push: drops destConfig and adds destPath (--accept-data-loss).
#  - apply: write the cached destPath values now that the column exists.
# Both phases tolerate either schema, so every boot is safe and idempotent.
echo "→ Backfilling job destinations from destConfig..."
node scripts/backfill-destpath.cjs --save

echo "→ Syncing database schema..."
node /opt/prisma/node_modules/prisma/build/index.js db push \
  --schema=/app/prisma/schema.prisma --skip-generate --accept-data-loss

echo "→ Applying destPath backfill..."
node scripts/backfill-destpath.cjs --apply

# Seed a default admin on the very first boot (no-op once any user exists).
node dist/seed.cjs

# Launch web + worker.
exec node scripts/docker-start.mjs
