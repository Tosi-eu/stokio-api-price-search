import axios from 'axios';
import { load } from 'cheerio';
import { logger } from '../logger';
import { reportPriceSearchError } from '../clients/error-ingest.client';
import type { PriceSourceStrategy } from '../types';

export class MercadoLivreStrategy implements PriceSourceStrategy {
  readonly sourceName = 'mercado_livre';

  supports(itemType: 'medicine' | 'input'): boolean {
    return itemType === 'input';
  }

  async fetchPrices({ itemName }: { itemName: string }): Promise<number[]> {
    try {
      const searchTerm = encodeURIComponent(
        itemName.toLowerCase().replace(/[^\w\s]/g, ' '),
      );

      const url = `https://lista.mercadolivre.com.br/${searchTerm}`;

      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        },
      });

      if (!response.data) return [];

      const $ = load(response.data);
      const prices: number[] = [];

      $('[class*="price"], [class*="preco"]').each((_, el) => {
        const text = $(el).text();
        const price = this.parsePrice(text);
        if (price && price >= 0.5 && price <= 10000) {
          prices.push(price);
        }
      });

      return prices;
    } catch (error) {
      logger.error('Erro no MercadoLivreStrategy', {
        error: (error as Error).message,
      });
      reportPriceSearchError(error, {
        context: { strategy: 'mercado_livre', itemName },
        code: 'mercado_livre_strategy',
      });
      return [];
    }
  }

  private parsePrice(text: string): number | null {
    const match = text.match(/R\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/);
    if (!match) return null;
    return parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
  }
}
