import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/app-config.module';
import { SearchModule } from './search/search.module';
import { AppController } from './controllers/app.controller';
import { PriceBackfillTriggerCron } from './cron/price-backfill-trigger.cron';

@Module({
  imports: [ScheduleModule.forRoot(), AppConfigModule, SearchModule],
  controllers: [AppController],
  providers: [PriceBackfillTriggerCron],
})
export class AppModule {}
