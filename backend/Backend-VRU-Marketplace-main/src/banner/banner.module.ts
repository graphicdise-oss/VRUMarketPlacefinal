import { Module } from '@nestjs/common';
import { BannerController } from './banner.controller.js';
import { BannerService } from './banner.service.js';

@Module({
  controllers: [BannerController],
  providers: [BannerService],
})
export class BannerModule {}
