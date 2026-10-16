import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SweepOutageService } from './sweep-outage.service.js';
import { SweepService } from './sweep.service.js';
import { describeErrorForLog } from '../common/errors/error-kind-for-log.js';

/** The cron's registered name — what a test stops it by (`SchedulerRegistry`). */
export const SWEEP_CRON_NAME = 'sweep';

/**
 * The only scheduler in this system.
 *
 * ⚠️⚠️ THIS TIES THE SYSTEM TO A SINGLE INSTANCE. It is one of exactly three such couplings,
 * and all three have to be dealt with together on the day this scales out:
 *
 *   1. this cron — two instances both fire it, so every deadline is processed twice. For an
 *      order cancellation that means cancelling something already cancelled; for a warning
 *      email it means sending two. The fix is a database lock (an advisory lock or a
 *      `SELECT ... FOR UPDATE SKIP LOCKED` over a leases table), not "probably fine".
 *   2. the in-memory Socket.io adapter — topic 11. Two instances cannot see each other's
 *      rooms, so a message reaches whichever half of the conversation shares a process.
 *   3. uploads on a local Docker volume (K1) — topic 4. A file written by one instance is a
 *      404 from the other.
 *
 * CLAUDE.md lists all three under the environment constraints. They are written out here
 * because this is the first of the three to exist in code, and a warning nobody encounters
 * while working is a warning that does not do anything.
 *
 * Every five minutes, not every minute: the shortest deadline in the system is 24 hours, so
 * five-minute granularity is at worst a five-minute delay on a day-long clock, and it is a
 * twelfth of the wakeups on a server that is short of memory.
 */
@Injectable()
export class SweepScheduler {
  private readonly logger = new Logger(SweepScheduler.name);

  constructor(
    private readonly sweep: SweepService,
    private readonly outage: SweepOutageService,
  ) {}

  // waitForCompletion, because it defaults to false: a sweep that takes longer than five minutes
  // would otherwise be started again while the first is still running, and the two would process
  // the same deadlines — cancelling an already-cancelled order, or sending two warning emails. That
  // is the same double-processing the comment above describes for two instances, except it happens
  // inside one process and needs no scaling out to appear.
  @Cron(CronExpression.EVERY_5_MINUTES, { name: SWEEP_CRON_NAME, waitForCompletion: true })
  async runScheduledSweep(): Promise<void> {
    // Catching here rather than letting it escape: an unhandled rejection inside a cron
    // callback can take the process down, and the process is also the API. SweepService
    // already isolates individual task failures, so reaching this catch means something
    // outside the tasks broke.
    try {
      // §116: before the sweep, never after — a sweep that ran first would end, against a clock
      // that was not running, the very deadlines the pause exists to save. A pause that fails
      // (the database still down) throws to the catch below and the sweep waits for the next
      // tick; the heartbeat did not move, so that run measures the whole gap again.
      await this.outage.recordRunAndPauseAfterOutage();
      const report = await this.sweep.run();
      await this.outage.recordRunFinished();

      if (report.hadFailures) {
        this.logger.warn('Scheduled sweep completed with failures; see the errors above.');
      }
    } catch (error) {
      this.logger.error(
        'Scheduled sweep could not run at all.',
        describeErrorForLog(error),
      );
    }
  }
}
