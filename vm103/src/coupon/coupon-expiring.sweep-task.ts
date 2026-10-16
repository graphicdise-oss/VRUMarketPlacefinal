import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays } from '../time/clock.js';
import { SweepTask } from '../time/sweep.js';
import { SweepService } from '../time/sweep.service.js';
import { NotificationService } from '../notification/notification.service.js';

/**
 * Sweeps claimed coupons that are nearing expiration (<= 3 days remaining)
 * and warns buyers through the notification system so they can use them before they expire.
 */
@Injectable()
export class CouponExpiringWarningSweepTask implements SweepTask, OnModuleInit {
  private readonly logger = new Logger(CouponExpiringWarningSweepTask.name);
  readonly sweepName = 'coupons.warnExpiringClaims';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const threeDaysLater = addDays(now, 3);

    // Find unused claims for active coupons ending within 3 days
    const expiringClaims = await this.prisma.userCouponClaim.findMany({
      where: {
        isUsed: false,
        coupon: {
          isActive: true,
          endDate: {
            gt: now,
            lte: threeDaysLater,
          },
        },
      },
      include: {
        coupon: {
          select: {
            id: true,
            code: true,
            name: true,
            endDate: true,
          },
        },
      },
    });

    let notifiedCount = 0;

    for (const claim of expiringClaims) {
      // Check if user already got a warning notification for this coupon
      const existing = await this.prisma.notification.findFirst({
        where: {
          userId: claim.userId,
          type: 'COUPON_EXPIRING_WARNING',
          targetId: claim.couponId,
        },
        select: { id: true },
      });

      if (existing) {
        continue;
      }

      const msLeft = claim.coupon.endDate.getTime() - now.getTime();
      const hoursLeft = Math.max(1, Math.floor(msLeft / (1000 * 60 * 60)));
      const daysLeft = Math.ceil(hoursLeft / 24);
      const timeText = daysLeft > 1 ? `ในอีก ${daysLeft} วัน` : `ในอีก ${hoursLeft} ชั่วโมง`;

      try {
        await this.notificationService.notify({
          userId: claim.userId,
          type: 'COUPON_EXPIRING_WARNING',
          message: `โค้ดส่วนลด "${claim.coupon.code}" (${claim.coupon.name}) ใกล้หมดอายุ${timeText} รีบใช้ช้อปก่อนหมดเขต!`,
          targetType: 'COUPON',
          targetId: claim.couponId,
        });
        notifiedCount++;
      } catch (err) {
        this.logger.error(`Failed to notify user ${claim.userId} about coupon ${claim.coupon.code}`, err);
      }
    }

    return notifiedCount;
  }
}
