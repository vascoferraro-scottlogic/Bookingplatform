#!/bin/sh
# One-shot database initialiser for the MVP stack. Runs from the fuller
# "builder" image (has the Prisma CLI + seed toolchain), so the slim app
# runtime never carries migration tooling.
set -e

echo "[init] Applying migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "[init] Checking whether the database needs seeding..."
COUNT="$(node scripts/tenant-count.mjs 2>/dev/null || echo error)"

if [ "$COUNT" = "0" ]; then
  echo "[init] Empty database — running seed..."
  npm run db:seed
elif [ "$COUNT" = "error" ]; then
  echo "[init] Could not read tenant count; skipping seed to avoid duplicates."
else
  echo "[init] Database already has $COUNT tenant(s) — skipping seed."
fi

echo "[init] Done."
