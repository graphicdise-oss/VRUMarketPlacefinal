import { Module } from '@nestjs/common';
import { AreaController } from './area.controller.js';
import { AreaService } from './area.service.js';

/** Province → district → subdistrict reference data (#46). Read-only, public, no imports needed. */
@Module({
  controllers: [AreaController],
  providers: [AreaService],
})
export class AreaModule {}
