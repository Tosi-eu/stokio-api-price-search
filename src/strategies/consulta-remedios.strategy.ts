import axios from 'axios';
import { load } from 'cheerio';
import { logger } from '../logger';
import { reportPriceSearchError } from '../clients/error-ingest.client';
import type { PriceSourceStrategy } from '../types';

export class ConsultaRemediosStrategy implements PriceSourceStrategy {
  readonly sourceName = 'consulta_remedios';

  supports(itemType: 'medicine' | 'input'): boolean {
    return itemType === 'medicine';
  }

  async fetchPrices({
    itemName,
    dosage,
    measurementUnit,
  }: {
    itemName: string;
    dosage?: string;
    measurementUnit?: string;
  }): Promise<number[]> {
    try {
      const normalizedPath = this.normalizeForUrl(
        itemName,
        dosage,
        measurementUnit,
      );

      const urls = [
        `https://www.consultaremedios.com.br/b/${normalizedPath}`,
        `https://www.consultaremedios.com.br/busca?q=${encodeURIComponent(
          normalizedPath.replace(/-/g, ' '),
        )}`,
      ];

      logger.debug('Buscando preços na Consulta Remédios', {
        source: this.sourceName,
        urls,
        normalizedPath,
      });

      for (const url of urls) {
        try {
          const response = await axios.get(url, {
            timeout: 15000,
            maxRedirects: 5,
            validateStatus: s => s >= 200 && s < 400,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
            },
          });

          if (!response.data) continue;

          const prices = this.extractPrices(response.data);
          if (prices.length > 0) return prices;
        } catch {
          continue;
        }
      }

      return [];
    } catch (error) {
      logger.error('Erro no ConsultaRemediosStrategy', {
        error: (error as Error).message,
      });
      reportPriceSearchError(error, {
        context: {
          strategy: 'consulta_remedios',
          itemName,
          dosage: dosage ?? null,
          measurementUnit: measurementUnit ?? null,
        },
        code: 'consulta_remedios_strategy',
      });
      return [];
    }
  }

  private normalizeForUrl(
    name: string,
    dosage?: string,
    measurementUnit?: string,
  ): string {
    let normalized = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');

    if (dosage) {
      let d = dosage.toLowerCase().replace(/\s+/g, '');
      if (measurementUnit && !d.includes(measurementUnit.toLowerCase())) {
        d += measurementUnit.toLowerCase();
      }
      normalized += `-${d}`;
    }

    return normalized;
  }

  private extractPrices(html: string): number[] {
    const $ = load(html);
    const prices: number[] = [];

    $('div:contains("R$")').each((_, el) => {
      const text = $(el).text();
      const price = this.parsePrice(text);
      if (price) prices.push(price);
    });

    return prices;
  }

  private parsePrice(text: string): number | null {
    const match = text.match(/R\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/);
    if (!match) return null;
    return parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
  }
}
