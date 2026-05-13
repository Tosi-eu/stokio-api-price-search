import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { reportPriceSearchError } from '../clients/error-ingest.client';

@Catch()
export class PriceSearchAllExceptionsFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  catch(exception: unknown, host: ArgumentsHost): void {
    try {
      const ctx = host.switchToHttp();
      const req = ctx.getRequest<{ method?: string; path?: string; url?: string }>();
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      reportPriceSearchError(exception, {
        httpMethod: req?.method ?? null,
        httpPath: req?.path ?? req?.url ?? null,
        httpStatus: status,
        code: 'nest_uncaught',
        context: { filter: 'PriceSearchAllExceptionsFilter' },
      });
    } catch {}
    super.catch(exception, host);
  }
}
