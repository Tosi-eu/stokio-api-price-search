import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { SearchModule } from './search/search.module';
import { AppController } from './controllers/app.controller';

@Module({
  imports: [AppConfigModule, SearchModule],
  controllers: [AppController],
})
export class AppModule {}
