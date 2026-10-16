import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SweepTask } from '../time/sweep.js';
import { SweepService } from '../time/sweep.service.js';
import { AccountErasureService } from './account-erasure.service.js';

/**
 * #71 (H9/H10): the cron that clears the queue `AccountErasureService.requestErasure` builds
 * instead of refusing outright. Every candidate is re-checked fresh, from scratch, on every pass —
 * nothing about "why" a request was queued is trusted from whenever it was first requested,
 * because the only thing that changes an answer here (an order finally clearing, per H10, or a
 * shop finally being closed) can happen at any later sweep, not necessarily the next one.
 *
 * Through the one sweep point (M5) — never a second scheduler.
 */
@Injectable()
export class AccountErasureQueueSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'accountErasure.processQueue';
  private readonly logger = new Logger(AccountErasureQueueSweepTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
    private readonly erasure: AccountErasureService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const candidates = await this.prisma.user.findMany({
      where: { erasureRequestedAt: { not: null }, erasedAt: null },
      select: { id: true },
    });

    let handled = 0;
    for (const candidate of candidates) {
      // §84: one account failing (for any reason — the marker collision this review found was one)
      // must not stop every account queued after it. `SweepService` isolates failures per *task*,
      // not per row, so before this a single account that threw kept everyone behind it waiting
      // on every pass, indefinitely — against H10's whole point. Left queued; the next pass retries.
      try {
        if (await this.erasure.tryClearQueuedRequest(candidate.id, now)) {
          handled += 1;
        }
      } catch (error) {
        this.logger.error(`Queued erasure for user ${candidate.id} failed; will retry next pass`, error instanceof Error ? error.stack : String(error));
      }
    }

    return handled;
  }
}
