import { logger } from '../logger';

/** Mediana amostral (valores finitos). */
export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('median: lista vazia');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Agrega cotações por fonte: cada fonte contribui com uma mediana intra-fonte.
 * Assim, acrescentar uma nova fonte acrescenta uma única "votação" na combinação final,
 * em vez de inflacionar o peso com dezenas de preços dessa fonte.
 */
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

    logger.debug('Análise de outliers', {
      operation: 'price_search',
      precos: sortedPrices.map(p => p.toFixed(2)),
      min: minPrice.toFixed(2),
      max: maxPrice.toFixed(2),
      mediana: median.toFixed(2),
    });

    if (prices.length === 2) {
      const diff = Math.abs(sortedPrices[1] - sortedPrices[0]);
      const maxDiff = sortedPrices[0] * 3;

      if (diff > maxDiff) {
        logger.debug('Diferença muito grande entre preços, usando menor', {
          operation: 'price_search',
          preco: minPrice.toFixed(2),
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

      logger.debug('Análise de outliers - estatísticas', {
        operation: 'price_search',
        mediaMetadeInferior: averageOfLowerHalf.toFixed(2),
        ratioMaximoMediana: maxPriceRatio.toFixed(2),
      });

      if (maxPriceRatio > 2.5) {
        filteredPrices = filteredPrices.filter(price => {
          const ratioToMedian = price / median;
          const ratioToLowerAvg = price / averageOfLowerHalf;

          const isOutlier = ratioToMedian > 3.0 || ratioToLowerAvg > 3.5;

          if (isOutlier) {
            logger.debug('Preço removido como outlier', {
              operation: 'price_search',
              preco: price.toFixed(2),
              ratioMediana: ratioToMedian.toFixed(2),
              ratioLowerAvg: ratioToLowerAvg.toFixed(2),
            });
            return false;
          }
          return true;
        });

        if (filteredPrices.length === 0) {
          logger.debug(
            'Todos os preços foram removidos no primeiro filtro, aplicando filtro mais permissivo',
            {
              operation: 'price_search',
            },
          );
          filteredPrices = sortedPrices.filter(price => {
            const ratioToLowerAvg = price / averageOfLowerHalf;
            const keep = ratioToLowerAvg <= 4.0;
            if (!keep) {
              logger.debug('Preço ainda muito alto', {
                operation: 'price_search',
                preco: price.toFixed(2),
                ratioToLowerAvg: ratioToLowerAvg.toFixed(2),
              });
            }
            return keep;
          });
        }

        if (filteredPrices.length === 0) {
          logger.warn(
            'Todos os preços foram removidos, usando média da metade inferior',
            {
              operation: 'price_search',
              preco: averageOfLowerHalf.toFixed(2),
            },
          );
          return [averageOfLowerHalf];
        }

        if (filteredPrices.length < sortedPrices.length) {
          const removed = sortedPrices.filter(p => !filteredPrices.includes(p));
          logger.debug('Outliers removidos', {
            operation: 'price_search',
            quantidadeRemovidos: removed.length,
            precosRemovidos: removed.map(p => p.toFixed(2)),
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

    logger.debug('Análise IQR', {
      operation: 'price_search',
      q1: q1.toFixed(2),
      q3: q3.toFixed(2),
      iqr: iqr.toFixed(2),
      limiteInferior: lowerBound.toFixed(2),
      limiteSuperior: upperBound.toFixed(2),
    });

    const finalFiltered = filteredPrices.filter(
      price => price >= lowerBound && price <= upperBound,
    );

    if (finalFiltered.length === 0) {
      const newMedian = filteredPrices[Math.floor(filteredPrices.length * 0.5)];
      logger.warn('IQR removeu todos, usando mediana', {
        operation: 'price_search',
        mediana: newMedian.toFixed(2),
      });
      return [newMedian];
    }

    const totalRemoved = sortedPrices.length - finalFiltered.length;

    if (totalRemoved > 0) {
      const removedAll = sortedPrices.filter(p => !finalFiltered.includes(p));
      logger.debug('Outliers removidos - resumo final', {
        operation: 'price_search',
        totalRemovidos: totalRemoved,
        precosRemovidos: removedAll.map(p => p.toFixed(2)),
        precosValidos: finalFiltered.map(p => p.toFixed(2)),
      });
    }

    return finalFiltered;
  }
}
