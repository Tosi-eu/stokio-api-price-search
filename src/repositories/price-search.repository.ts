import { Inject, Injectable } from '@nestjs/common';
import { type PriceCache } from '../lib/cache';
import {
  PRICE_CACHE,
} from '../lib/injection-tokens';
import { APP_CONFIG } from '../config/app-config.constants';
import type { AppConfig } from '../config/app-config';
import { PriceDbRepository } from './price-db.repository';
import {
  canonicalCacheKey,
  type CanonicalKey,
  type OriginalInput,
} from '../lib/normalize';
import { logger } from '../logger';

export type Freshness =
  | 'fresh' 
  | 'stale' 
  | 'miss-cached' 
  | 'absent'; 

export interface CachedHit {
  averagePrice: number;
  source: string;
  lastUpdated: Date;
}

export interface LookupResult {
  freshness: Freshness;
  level: 'L1' | 'L2' | null;
  hit: CachedHit | null;
}

interface L1Payload {
  averagePrice: number;
  source: string;
  lastUpdated: string;
  lastSucceededAt: string;
}

@Injectable()
export class PriceSearchRepository {
  private readonly hitTtlMs: number;
  private readonly missTtlMs: number;
  private readonly l1TtlSeconds: number;

  constructor(
    @Inject(PRICE_CACHE) private readonly l1: PriceCache,
    private readonly l2: PriceDbRepository,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.hitTtlMs = config.PRICE_HIT_TTL_DAYS * 24 * 60 * 60 * 1000;
    this.missTtlMs = config.PRICE_MISS_TTL_HOURS * 60 * 60 * 1000;
    this.l1TtlSeconds = config.PRICE_L1_TTL_SECONDS;
  }

  async lookup(key: CanonicalKey): Promise<LookupResult> {
    const cacheKey = canonicalCacheKey(key);

    
    const l1Hit = await this.l1.get<L1Payload>(cacheKey);
    if (l1Hit) {
      const lastSuccessMs = Date.parse(
        l1Hit.lastSucceededAt ?? l1Hit.lastUpdated,
      );
      if (
        Number.isFinite(lastSuccessMs) &&
        Date.now() - lastSuccessMs <= this.hitTtlMs
      ) {
        return {
          freshness: 'fresh',
          level: 'L1',
          hit: {
            averagePrice: l1Hit.averagePrice,
            source: l1Hit.source,
            lastUpdated: new Date(l1Hit.lastUpdated),
          },
        };
      }
    }

    
    const l2Hit = await this.l2.findByCanonical(key);
    if (!l2Hit) {
      return { freshness: 'absent', level: null, hit: null };
    }

    if (l2Hit.hasSuccess && l2Hit.lastSucceededAt) {
      const ageMs = Date.now() - l2Hit.lastSucceededAt.getTime();
      const hit: CachedHit = {
        averagePrice: l2Hit.averagePrice as number,
        source: l2Hit.source ?? '',
        lastUpdated: l2Hit.lastSucceededAt,
      };

      if (ageMs <= this.hitTtlMs) {
        
        await this.warmL1(cacheKey, hit);
        return { freshness: 'fresh', level: 'L2', hit };
      }

      return { freshness: 'stale', level: 'L2', hit };
    }

    
    const missAgeMs = Date.now() - l2Hit.lastAttemptedAt.getTime();
    if (missAgeMs <= this.missTtlMs) {
      return { freshness: 'miss-cached', level: 'L2', hit: null };
    }
    return { freshness: 'absent', level: null, hit: null };
  }

  async commitHit(
    key: CanonicalKey,
    original: OriginalInput,
    averagePrice: number,
    source: string,
    pricesPerSource: Record<string, number[]>,
  ): Promise<void> {
    const lastUpdated = new Date();

    await Promise.all([
      this.l2.upsertHit({
        key,
        original,
        averagePrice,
        source,
        pricesPerSource,
      }),
      this.warmL1(canonicalCacheKey(key), {
        averagePrice,
        source,
        lastUpdated,
      }),
    ]);
  }

  async commitMiss(
    key: CanonicalKey,
    original: OriginalInput,
    errorMessage?: string,
  ): Promise<void> {
    const cacheKey = canonicalCacheKey(key);
    await Promise.all([
      this.l2.upsertMiss({ key, original, errorMessage }),
      
      
      this.l1.invalidate(cacheKey).catch(err => {
        logger.warn('Failed to invalidate L1 after miss', {
          error: (err as Error).message,
        });
      }),
    ]);
  }

  async invalidate(key: CanonicalKey): Promise<void> {
    const cacheKey = canonicalCacheKey(key);
    await Promise.all([
      this.l1.invalidate(cacheKey),
      this.l2.deleteByCanonical(key),
    ]);
  }

  private async warmL1(cacheKey: string, hit: CachedHit): Promise<void> {
    const payload: L1Payload = {
      averagePrice: hit.averagePrice,
      source: hit.source,
      lastUpdated: hit.lastUpdated.toISOString(),
      lastSucceededAt: hit.lastUpdated.toISOString(),
    };
    try {
      await this.l1.set(cacheKey, payload, this.l1TtlSeconds);
    } catch (err) {
      logger.warn('Failed to warm L1', {
        error: (err as Error).message,
      });
    }
  }
}
