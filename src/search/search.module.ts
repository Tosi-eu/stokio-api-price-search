import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { SearchController } from '../controllers/search.controller';
import { PricingAuditInterceptor } from '../interceptors/pricing-audit.interceptor';
import { PriceSearchService } from '../services/price-search.service';
import { PriceSearchRepository } from '../repositories/price-search.repository';
import { PriceDbRepository } from '../repositories/price-db.repository';
import { PriceAggregator, OutlierFilter } from '../lib/aggregator';
import { createDefaultStrategies } from '../strategies';
import { createRedisCache, createNoopCache } from '../lib/cache';
import { APP_CONFIG } from '../config/app-config.constants';
import type { AppConfig } from '../config/app-config';
import { GlobalRateLimitMiddleware } from '../middleware/global-rate-limit.middleware';
import { PricingApiKeyMiddleware } from '../middleware/pricing-api-key.middleware';
import { SearchRateLimitMiddleware } from '../middleware/search-rate-limit.middleware';
import {
  PRICE_CACHE,
  PRICE_STRATEGIES,
  PRISMA_CLIENT,
  REDIS_CLIENT,
} from '../lib/injection-tokens';
import { logger } from '../logger';
import { reportPriceSearchError } from '../clients/error-ingest.client';
import { RedisShutdownHook } from '../lib/redis-shutdown.hook';
import { PrismaShutdownHook } from '../lib/prisma-shutdown.hook';
import { resolvePricingCacheDatabaseUrl } from '../config/database-url';

@Module({
  controllers: [SearchController],
  providers: [
    PricingAuditInterceptor,
    PriceSearchRepository,
    PriceDbRepository,
    PriceSearchService,
    PriceAggregator,
    OutlierFilter,
    GlobalRateLimitMiddleware,
    PricingApiKeyMiddleware,
    SearchRateLimitMiddleware,
    RedisShutdownHook,
    PrismaShutdownHook,
    {
      provide: REDIS_CLIENT,
      useFactory: (config: AppConfig): Redis | null => {
        if (!config.REDIS_HOST) {
          logger.warn('REDIS_HOST unset — L1 cache disabled');
          return null;
        }
        const client = new Redis({
          host: config.REDIS_HOST,
          port: config.REDIS_PORT,
          maxRetriesPerRequest: 3,
        });
        client.on('error', err => {
          logger.error('Redis error', { error: err.message });
          reportPriceSearchError(err, {
            category: 'integration',
            code: 'redis_client',
            context: { redisHost: config.REDIS_HOST },
          });
        });
        return client;
      },
      inject: [APP_CONFIG],
    },
    {
      provide: PRICE_CACHE,
      useFactory: (redis: Redis | null) =>
        redis ? createRedisCache(redis) : createNoopCache(),
      inject: [REDIS_CLIENT],
    },
    {
      provide: PRISMA_CLIENT,
      useFactory: (): PrismaClient | null => {
        const url = resolvePricingCacheDatabaseUrl();
        if (!url) {
          logger.warn(
            'DATABASE_URL / PRICING_CACHE_DATABASE_URL or PRICING_DB_* — L2 cache disabled',
          );
          return null;
        }
        const prisma = new PrismaClient({
          datasources: { db: { url } },
          log: ['warn', 'error'],
        });
        return prisma;
      },
    },
    {
      provide: PRICE_STRATEGIES,
      useFactory: () => createDefaultStrategies(),
    },
  ],
})
export class SearchModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(GlobalRateLimitMiddleware, PricingApiKeyMiddleware)
      .forRoutes(SearchController);

    consumer
      .apply(SearchRateLimitMiddleware)
      .forRoutes({ path: 'v1/search', method: RequestMethod.POST });
  }
}
