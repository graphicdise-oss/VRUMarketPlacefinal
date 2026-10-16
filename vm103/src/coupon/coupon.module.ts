import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TimeModule } from '../time/time.module.js';
import { CouponController } from './coupon.controller.js';
import { CouponService } from './coupon.service.js';
import { CouponExpiringWarningSweepTask } from './coupon-expiring.sweep-task.js';

@Module({
  imports: [PrismaModule, TimeModule],
  controllers: [CouponController],
  providers: [CouponService, CouponExpiringWarningSweepTask],
  exports: [CouponService],
})
export class CouponModule {}
