import { Inject, Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { logger } from '../logger';
import { reportPriceSearchError } from '../clients/error-ingest.client';
import { OutlierFilter, PriceAggregator, median } from '../lib/aggregator';
import type { PriceSourceStrategy, PriceSearchResult } from '../types';
import {
  PriceSearchRepository,
  type CachedHit,
  type Freshness,
} from '../repositories/price-search.repository';
import { PRICE_STRATEGIES } from '../lib/injection-tokens';
import {
  canonicalCacheKey,
  canonicalKey,
  type CanonicalKey,
  type ItemType,
  type OriginalInput,
} from '../lib/normalize';
import { BackgroundQueue } from '../lib/background-queue';
import { APP_CONFIG } from '../config/app-config.constants';
import type { AppConfig } from '../config/app-config';
import { CacheMetrics, type CacheOutcome } from '../lib/cache-metrics';

interface RunStrategiesOutcome {
  result: PriceSearchResult | null;
  pricesPerSource: Record<string, number[]>;
  errorMessage?: string;
}

@Injectable()
export class PriceSearchService implements OnModuleInit, OnApplicationShutdown {
  private readonly bgQueue: BackgroundQueue;
  private readonly metrics: CacheMetrics;

  constructor(
    private readonly repository: PriceSearchRepository,
    @Inject(PRICE_STRATEGIES)
    private readonly strategies: PriceSourceStrategy[],
    private readonly aggregator: PriceAggregator,
    private readonly outlierFilter: OutlierFilter,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.bgQueue = new BackgroundQueue(config.PRICE_BG_REFRESH_QUEUE_MAX);
    this.metrics = new CacheMetrics();
  }

  onModuleInit(): void {
    this.metrics.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.metrics.stop();
    this.metrics.flush();
  }

  async searchPrice(
    itemName: string,
    itemType: ItemType,
    dosage?: string,
    measurementUnit?: string,
  ): Promise<PriceSearchResult | null> {
    const original: OriginalInput = { itemName, dosage, measurementUnit };
    let key: CanonicalKey;
    try {
      key = canonicalKey(itemType, original);
    } catch (err) {
      logger.warn('canonicalKey rejected input', {
        error: (err as Error).message,
      });
      return null;
    }

    const lookup = await this.repository.lookup(key);
    this.logCacheLookup(key, lookup.freshness, lookup.level);

    switch (lookup.freshness) {
      case 'fresh':
        this.metrics.record(
          lookup.level === 'L1' ? 'hit_fresh_l1' : 'hit_fresh_l2',
        );
        return this.toResult(lookup.hit!);

      case 'stale': {
        this.metrics.record('hit_stale_revalidate');
        
        this.scheduleBackgroundRefresh(key, original);
        return this.toResult(lookup.hit!);
      }

      case 'miss-cached':
        this.metrics.record('miss_cached');
        
        return null;

      case 'absent':
      default:
        return this.runStrategiesAndCommit(key, original);
    }
  }

  async invalidatePriceCache(
    itemName: string,
    dosage: string | undefined,
    itemType: ItemType = 'medicine',
    measurementUnit?: string,
  ): Promise<void> {
    const key = canonicalKey(itemType, {
      itemName,
      dosage,
      measurementUnit,
    });
    await this.repository.invalidate(key);
    logger.info('Cache invalidated (L1 + L2)', {
      operation: 'price_cache_invalidate',
      itemType: key.itemType,
      nameCanonical: key.nameCanonical,
      dosageCanonical: key.dosageCanonical || null,
      unitCanonical: key.unitCanonical || null,
    });
  }

  private async runStrategiesAndCommit(
    key: CanonicalKey,
    original: OriginalInput,
  ): Promise<PriceSearchResult | null> {
    const outcome = await this.runStrategies(key, original);

    if (outcome.result) {
      this.metrics.record('origin_hit');
      await this.repository.commitHit(
        key,
        original,
        outcome.result.averagePrice as number,
        outcome.result.source,
        outcome.pricesPerSource,
      );
      return outcome.result;
    }

    this.metrics.record('origin_miss');
    await this.repository.commitMiss(key, original, outcome.errorMessage);
    return null;
  }

  
  getMetrics(): Record<CacheOutcome, number> {
    return this.metrics.snapshot();
  }

  private scheduleBackgroundRefresh(
    key: CanonicalKey,
    original: OriginalInput,
  ): void {
    const enqueued = this.bgQueue.enqueue(canonicalCacheKey(key), async () => {
      logger.info('Background refresh (stale)', {
        operation: 'price_search_bg_refresh',
        itemType: key.itemType,
        nameCanonical: key.nameCanonical,
      });
      await this.runStrategiesAndCommit(key, original);
    });
    if (enqueued) {
      logger.debug('Refresh task enqueued', {
        operation: 'price_search_bg_enqueue',
        bgInflight: this.bgQueue.size(),
      });
    }
  }

  private async runStrategies(
    key: CanonicalKey,
    original: OriginalInput,
  ): Promise<RunStrategiesOutcome> {
    const supportedStrategies = this.strategies.filter(strategy =>
      strategy.supports(key.itemType),
    );

    if (supportedStrategies.length === 0) {
      logger.warn('No strategy supports this item type', {
        operation: 'price_search',
        itemType: key.itemType,
      });
      return {
        result: null,
        pricesPerSource: {},
        errorMessage: 'no_supported_strategy',
      };
    }

    logger.debug('Strategies selected', {
      operation: 'price_search',
      itemType: key.itemType,
      strategies: supportedStrategies.map(s => s.sourceName),
    });

    const results = new Map<string, number[]>();
    const errors: string[] = [];

    await Promise.allSettled(
      supportedStrategies.map(async strategy => {
        try {
          logger.debug('Strategy started', {
            source: strategy.sourceName,
          });

          const prices = await strategy.fetchPrices({
            itemName: original.itemName,
            dosage: original.dosage,
            measurementUnit: original.measurementUnit,
          });

          logger.debug('Strategy finished', {
            source: strategy.sourceName,
            pricesFound: prices.length,
          });

          if (prices.length > 0) {
            results.set(strategy.sourceName, prices);
          }

          await new Promise(r => setTimeout(r, 800));
        } catch (error) {
          const msg = (error as Error).message;
          errors.push(`${strategy.sourceName}: ${msg}`);
          logger.error('Strategy error', {
            operation: 'price_search',
            source: strategy.sourceName,
            error: msg,
          });
          reportPriceSearchError(error, {
            context: {
              operation: 'price_search',
              strategy: strategy.sourceName,
              itemName: original.itemName,
              itemType: key.itemType,
              dosage: original.dosage ?? null,
              measurementUnit: original.measurementUnit ?? null,
            },
            code: 'price_search_strategy',
          });
        }
      }),
    );

    if (results.size === 0) {
      logger.info('No price found from any source', {
        operation: 'price_search',
        itemType: key.itemType,
        itemName: original.itemName,
        cacheLevel: 'origin',
        outcome: 'origin_miss',
      });
      return {
        result: null,
        pricesPerSource: {},
        errorMessage: errors.length > 0 ? errors.join(' | ') : undefined,
      };
    }

    const perSourcePrices = this.aggregator.perSourceMedians(results);
    if (perSourcePrices.length === 0) {
      return { result: null, pricesPerSource: mapToObj(results) };
    }

    const filteredPrices = this.outlierFilter.remove(perSourcePrices);
    if (filteredPrices.length === 0) {
      return { result: null, pricesPerSource: mapToObj(results) };
    }

    const referencePrice = median(filteredPrices);

    const result: PriceSearchResult = {
      averagePrice: Math.round(referencePrice * 100) / 100,
      source: Array.from(results.keys()).join(','),
      lastUpdated: new Date(),
    };

    logger.info('Price search completed', {
      operation: 'price_search',
      itemName: original.itemName,
      itemType: key.itemType,
      averagePrice: result.averagePrice,
      sources: result.source,
      cacheLevel: 'origin',
      outcome: 'origin_hit',
    });

    return { result, pricesPerSource: mapToObj(results) };
  }

  private toResult(hit: CachedHit): PriceSearchResult {
    return {
      averagePrice: hit.averagePrice,
      source: hit.source,
      lastUpdated: hit.lastUpdated,
    };
  }

  private logCacheLookup(
    key: CanonicalKey,
    freshness: Freshness,
    level: 'L1' | 'L2' | null,
  ): void {
    logger.info('Cache lookup', {
      operation: 'price_search_lookup',
      itemType: key.itemType,
      nameCanonical: key.nameCanonical,
      dosageCanonical: key.dosageCanonical || null,
      unitCanonical: key.unitCanonical || null,
      cacheLevel: level,
      freshness,
    });
  }
}

function mapToObj(map: Map<string, number[]>): Record<string, number[]> {
  const obj: Record<string, number[]> = {};
  for (const [k, v] of map.entries()) obj[k] = v;
  return obj;
}
