import axios from 'axios';
import { logger } from '../logger';
import { reportPriceSearchError } from '../clients/error-ingest.client';
import { withRetry } from '../lib/retry';
import type { PriceSourceStrategy } from '../types';

export class DrogaRaiaStrategy implements PriceSourceStrategy {
  readonly sourceName = 'droga_raia';

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
      const query = `${itemName} ${dosage ?? ''}`.trim();
      const url = `https://www.drogaraia.com.br/search?w=${encodeURIComponent(
        query,
      )}&search-type=direct`;

      logger.debug('Fetching prices from Droga Raia', {
        source: this.sourceName,
        url,
        query,
      });

      const response = await withRetry(
        () =>
          axios.get<string>(url, {
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0',
              Accept: 'text/html',
              'Accept-Language': 'pt-BR,pt;q=0.9',
            },
            validateStatus: status => status >= 200 && status < 400,
          }),
        { maxRetries: 3, initialDelayMs: 500 },
      );

      const nextData: unknown = this.extractNextData(response.data);

      if (!nextData || typeof nextData !== 'object') {
        logger.warn('Next.js __NEXT_DATA__ not found on page', {
          source: this.sourceName,
        });
        return [];
      }

      const data = nextData as {
        props?: {
          pageProps?: {
            pageProps?: {
              results?: {
                products?: Array<{ priceService?: number | string }>;
              };
            };
          };
        };
      };
      const products =
        data?.props?.pageProps?.pageProps?.results?.products ?? [];

      return products
        .map(product => Number(product.priceService) || null)
        .filter((price: number | null): price is number => price !== null);
    } catch (error) {
      logger.error('Droga Raia price fetch failed', {
        source: this.sourceName,
        error: (error as Error).message,
      });
      reportPriceSearchError(error, {
        context: {
          strategy: this.sourceName,
          itemName,
          dosage: dosage ?? null,
        },
        code: 'droga_raia_strategy',
      });
      return [];
    }
  }

  private extractNextData(html: string): unknown {
    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/,
    );

    if (!match || !match[1]) {
      return null;
    }

    try {
      return JSON.parse(match[1]) as unknown;
    } catch {
      return null;
    }
  }
}
