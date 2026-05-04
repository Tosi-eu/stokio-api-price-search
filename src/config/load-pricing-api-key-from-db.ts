import { Pool } from 'pg';
import { resolveMainDatabaseUrl } from './database-url';

export const PRICING_API_KEY_DB_ROW = 'runtime.pricing.api_key';

export async function loadPricingApiKeyFromDb(): Promise<string | null> {
  const url = resolveMainDatabaseUrl();
  if (!url) return null;

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const r = await pool.query<{ value: string | null }>(
      `SELECT value FROM public.system_config WHERE key = $1 LIMIT 1`,
      [PRICING_API_KEY_DB_ROW],
    );
    const raw = r.rows[0]?.value;
    if (raw == null || String(raw).trim() === '') return null;
    return String(raw).trim();
  } finally {
    await pool.end().catch(() => undefined);
  }
}
