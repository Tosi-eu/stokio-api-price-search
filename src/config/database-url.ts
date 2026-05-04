function ensurePricingSchema(url: string): string {
  if (/[?&]schema=/.test(url)) {
    return url.replace(/([?&])schema=[^&]*/, '$1schema=pricing');
  }
  return url.includes('?') ? `${url}&schema=pricing` : `${url}?schema=pricing`;
}

export function resolveMainDatabaseUrl(): string | null {
  const direct = process.env.STOKIO_DATABASE_URL?.trim();
  if (direct) return direct;

  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const name = process.env.DB_NAME?.trim();
  const pass = process.env.DB_PASSWORD ?? '';
  const rawPort = Number(process.env.DB_PORT);
  const port =
    Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 5432;

  if (!host || !user || !name) return null;

  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(String(pass));
  const encName = encodeURIComponent(name);

  return `postgresql://${encUser}:${encPass}@${host}:${port}/${encName}`;
}

export function resolvePricingCacheDatabaseUrl(): string | null {
  const direct =
    process.env.DATABASE_URL?.trim() ||
    process.env.PRICING_CACHE_DATABASE_URL?.trim();
  if (direct) return ensurePricingSchema(direct);

  const host =
    process.env.PRICING_DB_HOST?.trim() || process.env.DB_HOST?.trim();
  const user =
    process.env.PRICING_DB_USER?.trim() || process.env.DB_USER?.trim();
  const name =
    process.env.PRICING_DB_NAME?.trim() || process.env.DB_NAME?.trim();
  const pass =
    process.env.PRICING_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '';
  const rawPort = Number(process.env.PRICING_DB_PORT ?? process.env.DB_PORT);
  const port =
    Number.isFinite(Number(rawPort)) && Number(rawPort) > 0
      ? Number(rawPort)
      : 5432;

  if (!host || !user || !name) return null;

  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(String(pass));
  const encName = encodeURIComponent(name);

  return `postgresql://${encUser}:${encPass}@${host}:${port}/${encName}?schema=pricing`;
}
