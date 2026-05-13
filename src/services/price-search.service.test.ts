import { PriceSearchService } from './price-search.service';
import {
  PriceSearchRepository,
  type LookupResult,
} from '../repositories/price-search.repository';
import { PriceAggregator, OutlierFilter } from '../lib/aggregator';
import type { AppConfig } from '../config/app-config';
import type { PriceSourceStrategy } from '../types';

const baseConfig: AppConfig = {
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
  PRICING_API_KEY: 'test-key-1234',
};

interface RepoMocks {
  lookup: jest.Mock<Promise<LookupResult>, [unknown]>;
  commitHit: jest.Mock;
  commitMiss: jest.Mock;
  invalidate: jest.Mock;
}

function makeRepo(): {
  repo: PriceSearchRepository;
  mocks: RepoMocks;
} {
  const mocks: RepoMocks = {
    lookup: jest.fn(),
    commitHit: jest.fn(async () => undefined),
    commitMiss: jest.fn(async () => undefined),
    invalidate: jest.fn(async () => undefined),
  };
  const repo = mocks as unknown as PriceSearchRepository;
  return { repo, mocks };
}

function makeService(opts: {
  repoMocks?: RepoMocks;
  strategies?: PriceSourceStrategy[];
}): {
  service: PriceSearchService;
  repoMocks: RepoMocks;
} {
  const { repo, mocks } = opts.repoMocks
    ? { repo: opts.repoMocks as unknown as PriceSearchRepository, mocks: opts.repoMocks }
    : makeRepo();

  const service = new PriceSearchService(
    repo,
    opts.strategies ?? [],
    new PriceAggregator(),
    new OutlierFilter(),
    baseConfig,
  );
  return { service, repoMocks: mocks };
}

function makeFakeMedicineStrategy(
  prices: number[],
  sourceName = 'fake_med',
): PriceSourceStrategy {
  return {
    sourceName,
    supports: t => t === 'medicine',
    fetchPrices: jest.fn(async () => prices),
  };
}

describe('PriceSearchService SWR flow', () => {
  it('returns cached value on fresh L1 hit without calling strategies', async () => {
    const fetchSpy = jest.fn();
    const strat: PriceSourceStrategy = {
      sourceName: 'fake_med',
      supports: t => t === 'medicine',
      fetchPrices: fetchSpy,
    };
    const { service, repoMocks } = makeService({ strategies: [strat] });
    repoMocks.lookup.mockResolvedValueOnce({
      freshness: 'fresh',
      level: 'L1',
      hit: {
        averagePrice: 12.5,
        source: 'fake_med',
        lastUpdated: new Date('2026-04-01T00:00:00.000Z'),
      },
    });

    const result = await service.searchPrice('Dipirona', 'medicine', '500', 'mg');

    expect(result?.averagePrice).toBe(12.5);
    expect(result?.source).toBe('fake_med');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(repoMocks.commitHit).not.toHaveBeenCalled();
    expect(repoMocks.commitMiss).not.toHaveBeenCalled();
    expect(service.getMetrics().hit_fresh_l1).toBe(1);
  });

  it('returns cached value on fresh L2 hit without calling strategies', async () => {
    const fetchSpy = jest.fn();
    const strat: PriceSourceStrategy = {
      sourceName: 'fake_med',
      supports: t => t === 'medicine',
      fetchPrices: fetchSpy,
    };
    const { service, repoMocks } = makeService({ strategies: [strat] });
    repoMocks.lookup.mockResolvedValueOnce({
      freshness: 'fresh',
      level: 'L2',
      hit: {
        averagePrice: 9.99,
        source: 'fake_med',
        lastUpdated: new Date(),
      },
    });

    const r = await service.searchPrice('Dipirôna', 'medicine');
    expect(r?.averagePrice).toBe(9.99);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(service.getMetrics().hit_fresh_l2).toBe(1);
  });

  it('returns null without calling strategies on miss-cached', async () => {
    const fetchSpy = jest.fn();
    const strat: PriceSourceStrategy = {
      sourceName: 'fake_med',
      supports: t => t === 'medicine',
      fetchPrices: fetchSpy,
    };
    const { service, repoMocks } = makeService({ strategies: [strat] });
    repoMocks.lookup.mockResolvedValueOnce({
      freshness: 'miss-cached',
      level: 'L2',
      hit: null,
    });

    const r = await service.searchPrice('Diprona Inexistente', 'medicine');
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(repoMocks.commitHit).not.toHaveBeenCalled();
    expect(repoMocks.commitMiss).not.toHaveBeenCalled();
    expect(service.getMetrics().miss_cached).toBe(1);
  });

  it('runs strategies synchronously when absent and commits a hit', async () => {
    const strat = makeFakeMedicineStrategy([10, 12, 14]);
    const { service, repoMocks } = makeService({ strategies: [strat] });
    repoMocks.lookup.mockResolvedValueOnce({
      freshness: 'absent',
      level: null,
      hit: null,
    });

    const r = await service.searchPrice('Dipirona', 'medicine', '500', 'mg');

    expect(strat.fetchPrices).toHaveBeenCalledTimes(1);
    expect(r).not.toBeNull();
    expect(r?.averagePrice).toBe(12);
    expect(r?.source).toBe('fake_med');
    expect(repoMocks.commitHit).toHaveBeenCalledTimes(1);
    expect(repoMocks.commitMiss).not.toHaveBeenCalled();
    expect(service.getMetrics().origin_hit).toBe(1);
  }, 15_000);

  it('combines multiple sources by median of medians (no inflation from many quotes in one source)', async () => {
    const stratLow = makeFakeMedicineStrategy([10, 11, 12], 'cheap_chain');
    const stratHigh = makeFakeMedicineStrategy(
      [30, 31, 32, 33, 100],
      'wide_chain',
    );
    const { service, repoMocks } = makeService({
      strategies: [stratLow, stratHigh],
    });
    repoMocks.lookup.mockResolvedValueOnce({
      freshness: 'absent',
      level: null,
      hit: null,
    });

    const r = await service.searchPrice('TestMed', 'medicine');

    expect(r).not.toBeNull();
    
    expect(r?.averagePrice).toBe(21.5);
    expect(repoMocks.commitHit).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('commits a miss when no strategy returned prices', async () => {
    const strat: PriceSourceStrategy = {
      sourceName: 'fake_med',
      supports: t => t === 'medicine',
      fetchPrices: jest.fn(async () => []),
    };
    const { service, repoMocks } = makeService({ strategies: [strat] });
    repoMocks.lookup.mockResolvedValueOnce({
      freshness: 'absent',
      level: null,
      hit: null,
    });

    const r = await service.searchPrice('Itemxyz', 'medicine');
    expect(r).toBeNull();
    expect(repoMocks.commitHit).not.toHaveBeenCalled();
    expect(repoMocks.commitMiss).toHaveBeenCalledTimes(1);
    expect(service.getMetrics().origin_miss).toBe(1);
  }, 15_000);

  it('serves stale immediately and triggers async refresh in background', async () => {
    const strat = makeFakeMedicineStrategy([20]);
    const { service, repoMocks } = makeService({ strategies: [strat] });
    const cachedDate = new Date('2025-01-01T00:00:00.000Z');
    repoMocks.lookup.mockResolvedValueOnce({
      freshness: 'stale',
      level: 'L2',
      hit: {
        averagePrice: 15.0,
        source: 'old_source',
        lastUpdated: cachedDate,
      },
    });

    const r = await service.searchPrice('Dipirona', 'medicine', '500', 'mg');

    
    
    expect(r?.averagePrice).toBe(15.0);
    expect(r?.source).toBe('old_source');
    expect(service.getMetrics().hit_stale_revalidate).toBe(1);

    
    await waitUntil(
      () => (strat.fetchPrices as jest.Mock).mock.calls.length === 1,
      5000,
    );

    expect(strat.fetchPrices).toHaveBeenCalledTimes(1);
    
    await waitUntil(
      () => (repoMocks.commitHit as jest.Mock).mock.calls.length === 1,
      5000,
    );
    expect(repoMocks.commitHit).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('invalidate routes through repository.invalidate with canonical key', async () => {
    const { service, repoMocks } = makeService({ strategies: [] });

    await service.invalidatePriceCache(
      'Dipirôna',
      '500,0',
      'medicine',
      'MG',
    );

    expect(repoMocks.invalidate).toHaveBeenCalledTimes(1);
    expect(repoMocks.invalidate).toHaveBeenCalledWith({
      itemType: 'medicine',
      nameCanonical: 'dipirona',
      dosageCanonical: '500',
      unitCanonical: 'mg',
    });
  });
});

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('waitUntil timeout');
}
