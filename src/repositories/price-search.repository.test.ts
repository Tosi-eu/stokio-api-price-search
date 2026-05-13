import { PriceSearchRepository } from './price-search.repository';
import type { PriceCache } from '../lib/cache';
import type { PriceDbRepository, DbCacheEntry } from './price-db.repository';
import type { CanonicalKey } from '../lib/normalize';
import type { AppConfig } from '../config/app-config';

const config: AppConfig = {
  PORT: 3010,
  REDIS_PORT: 6379,
  SEARCH_RATE_LIMIT_WINDOW_MS: 60_000,
  SEARCH_RATE_LIMIT_MAX: 40,
  GLOBAL_RATE_LIMIT_WINDOW_MS: 15 * 60_000,
  GLOBAL_RATE_LIMIT_MAX: 300,
  PRICE_HIT_TTL_DAYS: 7,
  PRICE_MISS_TTL_HOURS: 6,
  PRICE_L1_TTL_SECONDS: 3600,
  PRICE_BG_REFRESH_QUEUE_MAX: 64,
  PRICING_API_KEY: 'k'.repeat(20),
};

function makeCache(): jest.Mocked<PriceCache> {
  return {
    get: jest.fn(),
    set: jest.fn(async () => undefined),
    invalidate: jest.fn(async () => undefined),
  };
}

function makeDb(): jest.Mocked<
  Pick<
    PriceDbRepository,
    'findByCanonical' | 'upsertHit' | 'upsertMiss' | 'deleteByCanonical' | 'isEnabled'
  >
> {
  return {
    findByCanonical: jest.fn(),
    upsertHit: jest.fn(async () => undefined),
    upsertMiss: jest.fn(async () => undefined),
    deleteByCanonical: jest.fn(async () => undefined),
    isEnabled: jest.fn(() => true),
  };
}

const KEY: CanonicalKey = {
  itemType: 'medicine',
  nameCanonical: 'dipirona',
  dosageCanonical: '500',
  unitCanonical: 'mg',
};

describe('PriceSearchRepository.lookup', () => {
  it('returns fresh hit from L1 when payload is recent', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    const lastSucceeded = new Date(Date.now() - 60 * 1000).toISOString();
    l1.get.mockResolvedValueOnce({
      averagePrice: 10,
      source: 'fake',
      lastUpdated: lastSucceeded,
      lastSucceededAt: lastSucceeded,
    });
    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );
    const r = await repo.lookup(KEY);

    expect(r.freshness).toBe('fresh');
    expect(r.level).toBe('L1');
    expect(r.hit?.averagePrice).toBe(10);
    expect(l2.findByCanonical).not.toHaveBeenCalled();
  });

  it('falls back to L2 when L1 misses, returns fresh and warms L1', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    l1.get.mockResolvedValueOnce(null);
    const lastSucceededAt = new Date(Date.now() - 24 * 60 * 60 * 1000); 
    const dbEntry: DbCacheEntry = {
      averagePrice: 9.5,
      source: 'fake',
      lastAttemptedAt: lastSucceededAt,
      lastSucceededAt,
      attemptsCount: 1,
      hasSuccess: true,
    };
    l2.findByCanonical.mockResolvedValueOnce(dbEntry);

    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );
    const r = await repo.lookup(KEY);

    expect(r.freshness).toBe('fresh');
    expect(r.level).toBe('L2');
    expect(r.hit?.averagePrice).toBe(9.5);
    expect(l1.set).toHaveBeenCalledTimes(1);
  });

  it('returns stale when L2 hit is older than HIT_TTL', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    l1.get.mockResolvedValueOnce(null);
    const veryOld = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); 
    l2.findByCanonical.mockResolvedValueOnce({
      averagePrice: 7,
      source: 'fake',
      lastAttemptedAt: veryOld,
      lastSucceededAt: veryOld,
      attemptsCount: 1,
      hasSuccess: true,
    });

    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );
    const r = await repo.lookup(KEY);

    expect(r.freshness).toBe('stale');
    expect(r.level).toBe('L2');
    expect(r.hit?.averagePrice).toBe(7);
  });

  it('returns miss-cached when L2 has only recent failed attempt', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    l1.get.mockResolvedValueOnce(null);
    const recentFail = new Date(Date.now() - 30 * 60 * 1000); 
    l2.findByCanonical.mockResolvedValueOnce({
      averagePrice: null,
      source: null,
      lastAttemptedAt: recentFail,
      lastSucceededAt: null,
      attemptsCount: 3,
      hasSuccess: false,
    });

    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );
    const r = await repo.lookup(KEY);

    expect(r.freshness).toBe('miss-cached');
    expect(r.hit).toBeNull();
  });

  it('returns absent when L2 miss is older than MISS_TTL', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    l1.get.mockResolvedValueOnce(null);
    const oldFail = new Date(Date.now() - 24 * 60 * 60 * 1000); 
    l2.findByCanonical.mockResolvedValueOnce({
      averagePrice: null,
      source: null,
      lastAttemptedAt: oldFail,
      lastSucceededAt: null,
      attemptsCount: 1,
      hasSuccess: false,
    });

    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );
    const r = await repo.lookup(KEY);

    expect(r.freshness).toBe('absent');
  });

  it('returns absent when nothing is cached anywhere', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    l1.get.mockResolvedValueOnce(null);
    l2.findByCanonical.mockResolvedValueOnce(null);

    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );
    const r = await repo.lookup(KEY);

    expect(r.freshness).toBe('absent');
  });
});

describe('PriceSearchRepository.commit / invalidate', () => {
  it('commitHit upserts L2 and writes to L1', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );

    await repo.commitHit(
      KEY,
      { itemName: 'Dipirona', dosage: '500', measurementUnit: 'mg' },
      11.5,
      'fake',
      { fake: [11, 12] },
    );

    expect(l2.upsertHit).toHaveBeenCalledTimes(1);
    expect(l1.set).toHaveBeenCalledTimes(1);
  });

  it('commitMiss upserts L2 miss and invalidates L1', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );

    await repo.commitMiss(KEY, { itemName: 'Dipirona' }, 'all_failed');

    expect(l2.upsertMiss).toHaveBeenCalledTimes(1);
    expect(l1.invalidate).toHaveBeenCalledTimes(1);
    expect(l1.set).not.toHaveBeenCalled();
  });

  it('invalidate clears both L1 and L2', async () => {
    const l1 = makeCache();
    const l2 = makeDb();
    const repo = new PriceSearchRepository(
      l1 as unknown as PriceCache,
      l2 as unknown as PriceDbRepository,
      config,
    );

    await repo.invalidate(KEY);

    expect(l1.invalidate).toHaveBeenCalledTimes(1);
    expect(l2.deleteByCanonical).toHaveBeenCalledTimes(1);
  });
});
