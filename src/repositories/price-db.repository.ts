import { Inject, Injectable } from '@nestjs/common';
import {
  PrismaClient,
  Prisma,
  PriceItemType,
} from '@prisma/client';
import { logger } from '../logger';
import { reportPriceSearchError } from '../clients/error-ingest.client';
import type { CanonicalKey, OriginalInput } from '../lib/normalize';
import { PRISMA_CLIENT } from '../lib/injection-tokens';

export interface DbCacheEntry {
  averagePrice: number | null;
  source: string | null;
  lastAttemptedAt: Date;
  lastSucceededAt: Date | null;
  attemptsCount: number;
  hasSuccess: boolean;
}

export interface UpsertHitInput {
  key: CanonicalKey;
  original: OriginalInput;
  averagePrice: number;
  source: string;
  pricesPerSource: Record<string, number[]>;
}

export interface UpsertMissInput {
  key: CanonicalKey;
  original: OriginalInput;
  errorMessage?: string;
}

@Injectable()
export class PriceDbRepository {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient | null,
  ) {}

  isEnabled(): boolean {
    return this.prisma !== null;
  }

  async findByCanonical(key: CanonicalKey): Promise<DbCacheEntry | null> {
    if (!this.prisma) return null;

    try {
      const row = await this.prisma.cachedPrice.findUnique({
        where: {
          itemType_nameCanonical_dosageCanonical_unitCanonical: {
            itemType: key.itemType as PriceItemType,
            nameCanonical: key.nameCanonical,
            dosageCanonical: key.dosageCanonical,
            unitCanonical: key.unitCanonical,
          },
        },
      });

      if (!row) return null;

      return {
        averagePrice:
          row.averagePrice !== null
            ? Number(row.averagePrice.toString())
            : null,
        source: row.sources,
        lastAttemptedAt: row.lastAttemptedAt,
        lastSucceededAt: row.lastSucceededAt,
        attemptsCount: row.attemptsCount,
        hasSuccess: row.lastSucceededAt !== null && row.averagePrice !== null,
      };
    } catch (error) {
      logger.error('Erro ao ler cached_price', {
        operation: 'price_db_find',
        error: (error as Error).message,
      });
      reportPriceSearchError(error, {
        category: 'integration',
        code: 'price_db_find',
        context: { key },
      });
      return null;
    }
  }

  async upsertHit(input: UpsertHitInput): Promise<void> {
    if (!this.prisma) return;

    const now = new Date();
    const data = {
      averagePrice: new Prisma.Decimal(input.averagePrice),
      sources: input.source.slice(0, 255),
      pricesPerSource: input.pricesPerSource as unknown as Prisma.InputJsonValue,
      lastAttemptedAt: now,
      lastSucceededAt: now,
      lastError: null,
      nameOriginal: input.original.itemName.slice(0, 500),
      dosageOriginal:
        input.original.dosage !== undefined
          ? input.original.dosage.slice(0, 200)
          : null,
      unitOriginal:
        input.original.measurementUnit !== undefined
          ? input.original.measurementUnit.slice(0, 50)
          : null,
    };

    try {
      await this.prisma.cachedPrice.upsert({
        where: {
          itemType_nameCanonical_dosageCanonical_unitCanonical: {
            itemType: input.key.itemType as PriceItemType,
            nameCanonical: input.key.nameCanonical,
            dosageCanonical: input.key.dosageCanonical,
            unitCanonical: input.key.unitCanonical,
          },
        },
        create: {
          itemType: input.key.itemType as PriceItemType,
          nameCanonical: input.key.nameCanonical,
          dosageCanonical: input.key.dosageCanonical,
          unitCanonical: input.key.unitCanonical,
          attemptsCount: 1,
          ...data,
        },
        update: {
          ...data,
          attemptsCount: { increment: 1 },
        },
      });
    } catch (error) {
      logger.error('Erro ao gravar cached_price (hit)', {
        operation: 'price_db_upsert_hit',
        error: (error as Error).message,
      });
      reportPriceSearchError(error, {
        category: 'integration',
        code: 'price_db_upsert_hit',
        context: { key: input.key },
      });
    }
  }

  async upsertMiss(input: UpsertMissInput): Promise<void> {
    if (!this.prisma) return;

    const now = new Date();
    const errorMessage = input.errorMessage
      ? input.errorMessage.slice(0, 500)
      : null;

    try {
      await this.prisma.cachedPrice.upsert({
        where: {
          itemType_nameCanonical_dosageCanonical_unitCanonical: {
            itemType: input.key.itemType as PriceItemType,
            nameCanonical: input.key.nameCanonical,
            dosageCanonical: input.key.dosageCanonical,
            unitCanonical: input.key.unitCanonical,
          },
        },
        create: {
          itemType: input.key.itemType as PriceItemType,
          nameCanonical: input.key.nameCanonical,
          dosageCanonical: input.key.dosageCanonical,
          unitCanonical: input.key.unitCanonical,
          nameOriginal: input.original.itemName.slice(0, 500),
          dosageOriginal:
            input.original.dosage !== undefined
              ? input.original.dosage.slice(0, 200)
              : null,
          unitOriginal:
            input.original.measurementUnit !== undefined
              ? input.original.measurementUnit.slice(0, 50)
              : null,
          attemptsCount: 1,
          lastAttemptedAt: now,
          lastError: errorMessage,
        },
        update: {
          lastAttemptedAt: now,
          lastError: errorMessage,
          attemptsCount: { increment: 1 },
        },
      });
    } catch (error) {
      logger.error('Erro ao gravar cached_price (miss)', {
        operation: 'price_db_upsert_miss',
        error: (error as Error).message,
      });
      reportPriceSearchError(error, {
        category: 'integration',
        code: 'price_db_upsert_miss',
        context: { key: input.key },
      });
    }
  }

  async deleteByCanonical(key: CanonicalKey): Promise<void> {
    if (!this.prisma) return;

    try {
      await this.prisma.cachedPrice.deleteMany({
        where: {
          itemType: key.itemType as PriceItemType,
          nameCanonical: key.nameCanonical,
          dosageCanonical: key.dosageCanonical,
          unitCanonical: key.unitCanonical,
        },
      });
    } catch (error) {
      logger.error('Erro ao apagar cached_price', {
        operation: 'price_db_delete',
        error: (error as Error).message,
      });
      reportPriceSearchError(error, {
        category: 'integration',
        code: 'price_db_delete',
        context: { key },
      });
    }
  }
}
