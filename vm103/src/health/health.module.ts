import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/**
 * The shape every feature module follows: module / controller / service / dto.
 * No module invents its own layout (CLAUDE.md, "ทุก module หน้าตาเหมือนกัน").
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
