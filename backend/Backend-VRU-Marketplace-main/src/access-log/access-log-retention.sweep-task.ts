import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays } from '../time/clock.js';
import { SweepTask } from '../time/sweep.js';
import { SweepService } from '../time/sweep.service.js';

/**
 * พ.ร.บ.คอมพิวเตอร์ ม.26: "ไม่น้อยกว่า 90 วัน" — so a row is deleted only once it is *older* than
 * 90 days (`lt`), never on the 90th day itself. An official may order longer retention (up to two
 * years); that would be a change here, made when it is asked for.
 */
export const ACCESS_LOG_RETENTION_DAYS = 90;

/** §98 (owner's decision in §93): the access log's own clean-up, on the one sweep (M5). */
@Injectable()
export class AccessLogRetentionSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'accessLog.purgeExpired';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const result = await this.prisma.accessLog.deleteMany({
      where: { occurredAt: { lt: addDays(now, -ACCESS_LOG_RETENTION_DAYS) } },
    });

    return result.count;
  }
}
