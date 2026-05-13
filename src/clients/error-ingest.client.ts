import { toCanonicalError, type ToCanonicalDefaults } from '@stokio/sdk';

const ORIGIN_APP = 'stokio-api-price-search';

function ingestBaseUrl(): string | null {
  const u = process.env.BACKEND_INTERNAL_URL?.trim().replace(/\/$/, '');
  return u || null;
}

function ingestApiKey(): string | null {
  return (
    process.env.ERROR_INGEST_API_KEY?.trim() ||
    process.env.X_API_KEY?.trim() ||
    null
  );
}

export function reportPriceSearchError(
  err: unknown,
  extra?: Partial<Omit<ToCanonicalDefaults, 'source'>>,
): void {
  const base = ingestBaseUrl();
  const key = ingestApiKey();
  if (!base || !key) return;

  const payload = toCanonicalError(err, {
    source: 'price_search',
    originApp: ORIGIN_APP,
    ...extra,
  });

  void fetch(`${base}/api/v1/internal/errors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
    },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}
