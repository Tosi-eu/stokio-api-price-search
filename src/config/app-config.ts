import { z } from 'zod';

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
  PRICING_API_KEY: z
    .string()
    .min(8, 'PRICING_API_KEY no ambiente deve ter pelo menos 8 caracteres'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Config inválida: ${JSON.stringify(msg)}`);
  }
  return parsed.data;
}
