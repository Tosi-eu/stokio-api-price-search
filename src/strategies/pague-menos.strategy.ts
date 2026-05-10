import axios from 'axios';
import { logger } from '../logger';
import { reportPriceSearchError } from '../clients/error-ingest.client';
import { vtexCatalogSearchQuery } from '../lib/normalize';
import { withRetry } from '../lib/retry';
import type { PriceSourceStrategy } from '../types';

interface VTEXProduct {
  items?: Array<{
    sellers?: Array<{
      commertialOffer?: { ListPrice?: number; Price?: number };
    }>;
  }>;
}

export class PagueMenosStrategy implements PriceSourceStrategy {
  readonly sourceName = 'pague_menos';

  supports(itemType: 'medicine' | 'input'): boolean {
    return itemType === 'medicine';
  }

  async fetchPrices({
    itemName,
    dosage,
  }: {
    itemName: string;
    dosage?: string;
  }): Promise<number[]> {
    try {
      const query = vtexCatalogSearchQuery(itemName, dosage);

      const url =
        'https://www.paguemenos.com.br/api/catalog_system/pub/products/search/' +
        encodeURIComponent(query);

      logger.debug('Buscando preços na Pague Menos (VTEX)', {
        source: this.sourceName,
        url,
        query,
        rawQuery: `${itemName} ${dosage ?? ''}`.trim(),
      });

      const response = await withRetry(
        () =>
          axios.get<VTEXProduct[]>(url, {
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0',
              Accept: 'application/json',
            },
            validateStatus: status => status >= 200 && status < 400,
          }),
        { maxRetries: 3, initialDelayMs: 500 },
      );

      const products = response.data ?? [];
      const prices: number[] = [];

      for (const product of products) {
        const item = product?.items?.[0];
        const seller = item?.sellers?.[0];
        const offer = seller?.commertialOffer;

        if (!offer) continue;

        const fullPrice =
          offer.ListPrice && offer.ListPrice > 0
            ? offer.ListPrice
            : offer.Price;

        if (typeof fullPrice === 'number' && fullPrice > 0) {
          prices.push(fullPrice);
        }
      }

      return prices;
    } catch (error) {
      logger.error('Erro ao buscar preços na Pague Menos', {
        source: this.sourceName,
        error: (error as Error).message,
      });
      reportPriceSearchError(error, {
        context: {
          strategy: this.sourceName,
          itemName,
          dosage: dosage ?? null,
        },
        code: 'pague_menos_strategy',
      });
      return [];
    }
  }
}
