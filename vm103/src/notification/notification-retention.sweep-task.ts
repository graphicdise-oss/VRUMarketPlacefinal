import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays } from '../time/clock.js';
import { SweepTask } from '../time/sweep.js';
import { SweepService } from '../time/sweep.service.js';

const RETENTION_DAYS = 180;

/**
 * L7: deletes every `Notification` row older than 180 days, through the one sweep point (M5) —
 * never a second scheduler. A plain `deleteMany` on a fixed cutoff is naturally idempotent:
 * running it twice in the same pass, or every 5 minutes forever, deletes nothing the first pass
 * already removed.
 */
@Injectable()
export class NotificationRetentionSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'notifications.purgeOld';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const cutoff = addDays(now, -RETENTION_DAYS);
    const result = await this.prisma.notification.deleteMany({ where: { createdAt: { lte: cutoff } } });

    return result.count;
  }
}
