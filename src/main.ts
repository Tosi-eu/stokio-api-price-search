import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PriceSearchAllExceptionsFilter } from './filters/all-exceptions.filter';
import { APP_CONFIG } from './config/app-config.constants';
import type { AppConfig } from './config/app-config';
import { logger } from './logger';
import { reportPriceSearchError } from './clients/error-ingest.client';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.set('trust proxy', 1);
  app.use(helmet());
  app.useBodyParser('json', { limit: '256kb' });
  app.enableShutdownHooks();
  app.useGlobalFilters(new PriceSearchAllExceptionsFilter());

  const config = app.get<AppConfig>(APP_CONFIG);

  await app.listen(config.PORT, '0.0.0.0');

  logger.info('porto-api-price-search escutando', {
    port: config.PORT,
    redis: Boolean(config.REDIS_HOST),
  });
}

bootstrap().catch(err => {
  logger.error('Falha ao iniciar aplicação', { error: (err as Error).message });
  reportPriceSearchError(err, {
    category: 'config',
    code: 'bootstrap',
    context: { phase: 'bootstrap' },
  });
  process.exit(1);
});
