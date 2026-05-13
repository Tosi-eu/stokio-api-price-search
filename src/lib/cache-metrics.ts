import { logger } from '../logger';

export type CacheOutcome =
  | 'hit_fresh_l1'
  | 'hit_fresh_l2'
  | 'hit_stale_revalidate'
  | 'miss_cached'
  | 'origin_hit'
  | 'origin_miss';

const OUTCOMES: CacheOutcome[] = [
  'hit_fresh_l1',
  'hit_fresh_l2',
  'hit_stale_revalidate',
  'miss_cached',
  'origin_hit',
  'origin_miss',
];

export class CacheMetrics {
  private counters: Record<CacheOutcome, number>;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly flushIntervalMs: number = 5 * 60 * 1000) {
    this.counters = this.zeroCounters();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  record(outcome: CacheOutcome): void {
    this.counters[outcome] = (this.counters[outcome] ?? 0) + 1;
  }

  flush(): void {
    const total = OUTCOMES.reduce((s, k) => s + (this.counters[k] ?? 0), 0);
    if (total === 0) return;
    logger.info('price_cache_metrics_flush', {
      operation: 'price_cache_metrics',
      windowMs: this.flushIntervalMs,
      total,
      ...this.counters,
    });
    this.counters = this.zeroCounters();
  }

  snapshot(): Record<CacheOutcome, number> {
    return { ...this.counters };
  }

  private zeroCounters(): Record<CacheOutcome, number> {
    const obj: Partial<Record<CacheOutcome, number>> = {};
    for (const k of OUTCOMES) obj[k] = 0;
    return obj as Record<CacheOutcome, number>;
  }
}
