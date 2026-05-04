import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { PricingAuditInterceptor } from '../interceptors/pricing-audit.interceptor';
import { PriceSearchService } from '../services/price-search.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  invalidateCacheBodySchema,
  searchBodySchema,
  type InvalidateCacheBodyDto,
  type SearchBodyDto,
} from './dto/search-body.dto';
import { logger } from '../logger';

@Controller('v1')
@UseInterceptors(PricingAuditInterceptor)
export class SearchController {
  constructor(private readonly priceSearchService: PriceSearchService) {}

  @Post('search')
  async search(
    @Body(new ZodValidationPipe(searchBodySchema)) body: SearchBodyDto,
  ) {
    const { itemName, itemType, dosage, measurementUnit } = body;

    try {
      const result = await this.priceSearchService.searchPrice(
        itemName,
        itemType,
        dosage,
        measurementUnit,
      );

      if (!result) {
        return {
          averagePrice: null,
          source: '',
          lastUpdated: null,
        };
      }

      return {
        averagePrice: result.averagePrice,
        source: result.source,
        lastUpdated: result.lastUpdated.toISOString(),
      };
    } catch (e) {
      logger.error('Erro na busca de preço', {
        error: (e as Error).message,
      });
      throw new HttpException(
        { error: 'Erro ao buscar preço' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('cache/invalidate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async invalidateCache(
    @Body(new ZodValidationPipe(invalidateCacheBodySchema))
    body: InvalidateCacheBodyDto,
  ): Promise<void> {
    try {
      await this.priceSearchService.invalidatePriceCache(
        body.itemName,
        body.dosage,
        body.itemType,
        body.measurementUnit,
      );
    } catch (e) {
      logger.error('Erro ao invalidar cache', {
        error: (e as Error).message,
      });
      throw new HttpException(
        { error: 'Erro ao invalidar cache' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
