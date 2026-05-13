import { logger } from '../logger';

export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('median: empty list');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export class PriceAggregator {
  perSourceMedians(results: Map<string, number[]>): number[] {
    const reps: number[] = [];
    for (const [, prices] of results.entries()) {
      if (prices.length === 0) continue;
      reps.push(median(prices));
    }
    return reps;
  }
}

export class OutlierFilter {
  remove(prices: number[]): number[] {
    if (prices.length === 0) {
      return [];
    }

    if (prices.length === 1) {
      return prices;
    }

    const sortedPrices = [...prices].sort((a, b) => a - b);
    const minPrice = sortedPrices[0];
    const maxPrice = sortedPrices[sortedPrices.length - 1];
    const medianIndex = Math.floor(sortedPrices.length * 0.5);
    const median = sortedPrices[medianIndex];

    logger.debug('Outlier analysis', {
      operation: 'price_search',
      prices: sortedPrices.map(p => p.toFixed(2)),
      min: minPrice.toFixed(2),
      max: maxPrice.toFixed(2),
      median: median.toFixed(2),
    });

    if (prices.length === 2) {
      const diff = Math.abs(sortedPrices[1] - sortedPrices[0]);
      const maxDiff = sortedPrices[0] * 3;

      if (diff > maxDiff) {
        logger.debug('Large spread between two prices, using lower', {
          operation: 'price_search',
          price: minPrice.toFixed(2),
        });
        return [minPrice];
      }
      return sortedPrices;
    }

    let filteredPrices = [...sortedPrices];

    if (sortedPrices.length >= 3) {
      const averageOfLowerHalf =
        sortedPrices
          .slice(0, Math.ceil(sortedPrices.length / 2))
          .reduce((sum, p) => sum + p, 0) / Math.ceil(sortedPrices.length / 2);
      const maxPriceRatio = maxPrice / median;

      logger.debug('Outlier analysis — stats', {
        operation: 'price_search',
        lowerHalfAverage: averageOfLowerHalf.toFixed(2),
        maxToMedianRatio: maxPriceRatio.toFixed(2),
      });

      if (maxPriceRatio > 2.5) {
        filteredPrices = filteredPrices.filter(price => {
          const ratioToMedian = price / median;
          const ratioToLowerAvg = price / averageOfLowerHalf;

          const isOutlier = ratioToMedian > 3.0 || ratioToLowerAvg > 3.5;

          if (isOutlier) {
            logger.debug('Price removed as outlier', {
              operation: 'price_search',
              price: price.toFixed(2),
              ratioToMedian: ratioToMedian.toFixed(2),
              ratioToLowerAvg: ratioToLowerAvg.toFixed(2),
            });
            return false;
          }
          return true;
        });

        if (filteredPrices.length === 0) {
          logger.debug(
            'All prices removed in first pass, applying looser filter',
            {
              operation: 'price_search',
            },
          );
          filteredPrices = sortedPrices.filter(price => {
            const ratioToLowerAvg = price / averageOfLowerHalf;
            const keep = ratioToLowerAvg <= 4.0;
            if (!keep) {
              logger.debug('Price still too high', {
                operation: 'price_search',
                price: price.toFixed(2),
                ratioToLowerAvg: ratioToLowerAvg.toFixed(2),
              });
            }
            return keep;
          });
        }

        if (filteredPrices.length === 0) {
          logger.warn(
            'All prices removed, using lower-half average',
            {
              operation: 'price_search',
              price: averageOfLowerHalf.toFixed(2),
            },
          );
          return [averageOfLowerHalf];
        }

        if (filteredPrices.length < sortedPrices.length) {
          const removed = sortedPrices.filter(p => !filteredPrices.includes(p));
          logger.debug('Outliers removed', {
            operation: 'price_search',
            removedCount: removed.length,
            removedPrices: removed.map(p => p.toFixed(2)),
          });
        }
      }
    }

    if (filteredPrices.length <= 2) {
      return filteredPrices;
    }

    const q1Index = Math.floor(filteredPrices.length * 0.25);
    const q3Index = Math.floor(filteredPrices.length * 0.75);

    const q1 = filteredPrices[q1Index];
    const q3 = filteredPrices[q3Index];
    const iqr = q3 - q1;

    if (iqr === 0) {
      return filteredPrices;
    }

    const lowerBound = Math.max(0, q1 - 1.5 * iqr);
    const upperBound = q3 + 1.5 * iqr;

    logger.debug('IQR analysis', {
      operation: 'price_search',
      q1: q1.toFixed(2),
      q3: q3.toFixed(2),
      iqr: iqr.toFixed(2),
      lowerBound: lowerBound.toFixed(2),
      upperBound: upperBound.toFixed(2),
    });

    const finalFiltered = filteredPrices.filter(
      price => price >= lowerBound && price <= upperBound,
    );

    if (finalFiltered.length === 0) {
      const newMedian = filteredPrices[Math.floor(filteredPrices.length * 0.5)];
      logger.warn('IQR removed all, using median', {
        operation: 'price_search',
        median: newMedian.toFixed(2),
      });
      return [newMedian];
    }

    const totalRemoved = sortedPrices.length - finalFiltered.length;

    if (totalRemoved > 0) {
      const removedAll = sortedPrices.filter(p => !finalFiltered.includes(p));
      logger.debug('Outliers removed — final summary', {
        operation: 'price_search',
        totalRemoved,
        removedPrices: removedAll.map(p => p.toFixed(2)),
        keptPrices: finalFiltered.map(p => p.toFixed(2)),
      });
    }

    return finalFiltered;
  }
}
