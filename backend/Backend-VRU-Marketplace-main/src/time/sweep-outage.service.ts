import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../common/id.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock, MS_PER_MINUTE } from './clock.js';
import { PausableClocks } from './sweep.js';

/**
 * Three missed runs of the five-minute cron. Shorter would read a slow sweep or a restart as an
 * outage; longer would let a real one eat into a deadline unnoticed. Even at the threshold the
 * pause is the whole gap, not the part past it — the cut-off decides *whether* to pause, not how
 * much.
 */
export const OUTAGE_THRESHOLD_MINUTES = 15;

const SCHEDULER_HEARTBEAT = 'scheduler';

/**
 * §116: deadlines stop while the system is down — the same "the clock stops while nobody can act"
 * H3 already applies to a frozen order, applied to the platform itself.
 *
 * Without this, a server that was down overnight came back and its first sweep cancelled every
 * order whose window ran out in the dark, moved shops that could not sign in to confirm a payment
 * into REFUND_ORDERED, and skipped each warning on the way (a warning only fires before expiry).
 *
 * How long the system was down is read from the scheduler's own heartbeat — written as a run starts
 * and again as it finishes — not from the process's start time: a database that was unreachable while the process stayed up is the same outage to
 * everyone using it, and only a missed sweep sees both. The heartbeat is written by the scheduler
 * alone, so a test that moves the TestClock and calls `sweep.run()` is never read as an outage.
 */
@Injectable()
export class SweepOutageService {
  private readonly logger = new Logger(SweepOutageService.name);
  private readonly clocks = new Map<string, PausableClocks>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** As `SweepService.register` — modules call this from `onModuleInit`, keyed by name. */
  register(clocks: PausableClocks): void {
    this.clocks.set(clocks.clocksName, clocks);
  }

  /**
   * Moves the heartbeat to now and, if the previous one is older than the threshold, pauses every
   * registered clock for the gap — all in one transaction, under the heartbeat row's lock, so a
   * gap is paid out once whatever runs alongside. Returns the seconds paused (0 for none).
   */
  async recordRunAndPauseAfterOutage(): Promise<number> {
    const now = this.clock.now();

    const { pausedSeconds, shifted } = await this.prisma.$transaction(async (tx) => {
      const [previous] = await tx.$queryRaw<{ last_run_at: Date }[]>`
        SELECT last_run_at FROM sweep_heartbeat WHERE name = ${SCHEDULER_HEARTBEAT} FOR UPDATE`;
      if (previous === undefined) {
        // The first scheduled run on this database — nothing to measure a gap from.
        await tx.sweepHeartbeat.create({ data: { id: newId(), name: SCHEDULER_HEARTBEAT, lastRunAt: now } });
        return { pausedSeconds: 0, shifted: 0 };
      }
      await tx.sweepHeartbeat.update({ where: { name: SCHEDULER_HEARTBEAT }, data: { lastRunAt: now } });

      const gapMs = now.getTime() - previous.last_run_at.getTime();
      if (gapMs <= OUTAGE_THRESHOLD_MINUTES * MS_PER_MINUTE) {
        return { pausedSeconds: 0, shifted: 0 };
      }

      const seconds = Math.round(gapMs / 1000);
      let moved = 0;
      for (const clocks of this.clocks.values()) {
        moved += await clocks.shiftRunningClocks(tx, previous.last_run_at, seconds);
      }
      return { pausedSeconds: seconds, shifted: moved };
    });

    if (pausedSeconds > 0) {
      // Counts only — nothing here names a person or an order.
      this.logger.warn(`No sweep ran for ${Math.round(pausedSeconds / 60)} minutes; paused ${shifted} running deadlines by that much.`);
    }

    return pausedSeconds;
  }

  /**
   * §122 review: moves the heartbeat again once the sweep has finished, so the next run measures
   * its gap from the end of this one. Measured from the start alone, a sweep that ran past fifteen
   * minutes — the cron skips its ticks meanwhile (`waitForCompletion`) — read as an outage the
   * moment it ended, and paused every clock while the API had been up the whole time.
   */
  async recordRunFinished(): Promise<void> {
    await this.prisma.sweepHeartbeat.updateMany({ where: { name: SCHEDULER_HEARTBEAT }, data: { lastRunAt: this.clock.now() } });
  }
}
