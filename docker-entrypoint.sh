#!/bin/sh
set -e
cd /app

if [ -z "${DATABASE_URL:-}" ] && [ -n "${PRICING_CACHE_DATABASE_URL:-}" ]; then
  export DATABASE_URL="$PRICING_CACHE_DATABASE_URL"
fi

if [ -z "${DATABASE_URL:-}" ] && [ -n "${PRICING_DB_HOST:-}" ] && [ -n "${PRICING_DB_USER:-}" ] && [ -n "${PRICING_DB_NAME:-}" ]; then
  export DATABASE_URL="$(
    node -e "
      const u = encodeURIComponent(process.env.PRICING_DB_USER || '');
      const p = encodeURIComponent(process.env.PRICING_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '');
      const h = process.env.PRICING_DB_HOST || '';
      const port = process.env.PRICING_DB_PORT || process.env.DB_PORT || '5432';
      const db = process.env.PRICING_DB_NAME || '';
      console.log(
        'postgresql://' + u + ':' + p + '@' + h + ':' + port + '/' + encodeURIComponent(db) + '?schema=pricing',
      );
    "
  )"
fi

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_HOST:-}" ] && [ -n "${DB_USER:-}" ] && [ -n "${DB_NAME:-}" ]; then
  export DATABASE_URL="$(
    node -e "
      const u = encodeURIComponent(process.env.DB_USER || '');
      const p = encodeURIComponent(process.env.DB_PASSWORD || '');
      const h = process.env.DB_HOST || 'localhost';
      const port = process.env.DB_PORT || '5432';
      const db = process.env.DB_NAME || 'estoque';
      console.log(
        'postgresql://' + u + ':' + p + '@' + h + ':' + port + '/' + encodeURIComponent(db) + '?schema=pricing',
      );
    "
  )"
fi

if [ "${SKIP_PRISMA_MIGRATE:-0}" != "1" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "[price-search/entrypoint] prisma migrate deploy"
  npx prisma migrate deploy
fi

exec "$@"
