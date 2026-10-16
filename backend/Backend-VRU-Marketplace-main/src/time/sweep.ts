import type { Prisma } from '@prisma/client';

/**
 * One piece of time-driven work.
 *
 * Every clock in the system is a task here — expiring a shipping quote, expiring a transfer
 * window, turning an unconfirmed payment into REFUND_ORDERED, sending a warning before a
 * deadline. Topic 7 writes the real ones; this ticket only builds the place they plug into.
 */
export interface SweepTask {
  /** Stable identifier, used in the report and in logs. Keep it greppable. */
  readonly sweepName: string;

  /**
   * Do the work that is due as of `now`.
   *
   * Receives the instant rather than reading a clock, so that a task cannot accidentally
   * disagree with the sweep that called it — which during a test looks like a business-rule
   * bug rather than a clock bug.
   *
   * Returns how many items it acted on, which is what makes a sweep observable without
   * reaching into the database.
   */
  runSweep(now: Date): Promise<number>;
}

export interface SweepTaskOutcome {
  readonly name: string;
  /** Items acted on, or null when the task failed. */
  readonly handled: number | null;
  readonly failed: boolean;
}

export interface SweepReport {
  readonly startedAt: Date;
  readonly outcomes: readonly SweepTaskOutcome[];
  /** True when at least one task threw. The sweep still ran the others. */
  readonly hadFailures: boolean;
}

/**
 * §116: a module's deadlines, as something the scheduler can pause after an outage.
 *
 * A sweep task asks "what is due as of now"; this answers a different question — "the system was
 * down from `since` for `seconds`, push out everything that was counting through it". Kept apart
 * from `SweepTask` because it runs only on the scheduler's path, before the sweep, inside the
 * transaction that also moves the heartbeat: a pause that half-applied, or applied twice, would
 * hand someone time nobody lost.
 */
export interface PausableClocks {
  readonly clocksName: string;

  /** Pushes out every deadline that was already running at `since`. Returns how many rows moved. */
  shiftRunningClocks(tx: Prisma.TransactionClient, since: Date, seconds: number): Promise<number>;
}
