import { z } from 'zod';
import { loadPricingApiKeyFromDb } from './load-pricing-api-key-from-db';
import { resolveMainDatabaseUrl } from './database-url';

const envSchema = z.object({
  PORT: z.coerce.number().default(3010),
  NODE_ENV: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().default(6379),
  SEARCH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  SEARCH_RATE_LIMIT_MAX: z.coerce.number().default(40),
  GLOBAL_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60_000),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().default(300),
  PRICE_HIT_TTL_DAYS: z.coerce.number().default(7),
  PRICE_MISS_TTL_HOURS: z.coerce.number().default(6),
  PRICE_L1_TTL_SECONDS: z.coerce.number().default(60 * 60),
  PRICE_BG_REFRESH_QUEUE_MAX: z.coerce.number().default(64),
});

export type AppConfig = z.infer<typeof envSchema> & {
  PRICING_API_KEY: string;
};

export async function loadConfig(): Promise<AppConfig> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Config inválida: ${JSON.stringify(msg)}`);
  }

  if (!resolveMainDatabaseUrl()) {
    throw new Error(
      'Ligação ao Postgres do Abrigo indisponível: defina STOKIO_DATABASE_URL ou DB_HOST, DB_USER, DB_NAME (leitura de public.system_config / runtime.pricing.api_key).',
    );
  }

  const pricingKey = await loadPricingApiKeyFromDb();
  if (!pricingKey || pricingKey.length < 8) {
    throw new Error(
      'Chave da API de preços ausente ou curta: configure em Sistema (backend) `runtime.pricing.api_key` / mesmo valor que o cliente envia em X-Pricing-API-Key.',
    );
  }

  return {
    ...parsed.data,
    PRICING_API_KEY: pricingKey,
  };
}
