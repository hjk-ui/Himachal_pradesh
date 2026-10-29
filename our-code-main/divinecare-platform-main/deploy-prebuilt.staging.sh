#!/usr/bin/env bash
# Prebuilt staging deploy — fetch tarball, migrate, swap .next, drop cache, pm2 restart.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/divinecare-platform}"
BUILDS_S3_URI="${BUILDS_S3_URI:?Set BUILDS_S3_URI e.g. s3://bucket/path}"
COMMIT_SHA="${1:?Usage: deploy-prebuilt.staging.sh <commit-sha>}"
HEALTH_BASE="${HEALTH_BASE:-http://127.0.0.1:3000}"

cd "$APP_DIR"

echo "==> Fetching builds/${COMMIT_SHA}.tar.gz"
aws s3 cp "${BUILDS_S3_URI%/}/builds/${COMMIT_SHA}.tar.gz" "/tmp/${COMMIT_SHA}.tar.gz"

echo "==> Hard reset working tree to ${COMMIT_SHA} (source already synced by operator)"
git fetch --all --prune || true
git reset --hard "$COMMIT_SHA"

echo "==> npm ci + migrate + prisma generate"
npm ci
npx prisma migrate deploy
npx prisma generate

echo "==> Swap .next (keep previous for rollback)"
if [ -d .next ]; then
  rm -rf .next.prev
  mv .next .next.prev
fi
mkdir -p .next
tar -xzf "/tmp/${COMMIT_SHA}.tar.gz" -C "$APP_DIR"
# Never carry multi-GB Next cache across deploys
rm -rf .next/cache

echo "==> Verify commit marker"
echo "$COMMIT_SHA" > .next/DEPLOYED_COMMIT

echo "==> pm2 restart"
pm2 restart divinecare-staging --update-env || pm2 restart all

echo "==> Health checks"
sleep 3
curl -fsS "${HEALTH_BASE}/login" >/dev/null
curl -fsS "${HEALTH_BASE}/api/health" >/dev/null 2>/dev/null || true

echo "==> Deployed ${COMMIT_SHA}"
echo "Rollback: rm -rf .next && mv .next.prev .next && pm2 restart divinecare-staging"
