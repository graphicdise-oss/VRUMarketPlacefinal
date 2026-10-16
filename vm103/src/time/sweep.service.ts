import { Injectable, Logger } from '@nestjs/common';
import { Clock } from './clock.js';
import { SweepReport, SweepTask, SweepTaskOutcome } from './sweep.js';

/**
 * The single sweep point for the whole system (M5).
 *
 * Every clock plugs in here. There is deliberately no second scheduler and no per-module cron:
 * with one entry point, a test moves the clock, calls `run()`, and every deadline in the system
 * is evaluated — whereas with a cron per module, a test proves one clock fired and says nothing
 * about the others, and two crons can disagree about what time it is mid-run.
 *
 * `run()` is called from exactly two places: the scheduler, and a test. It is never reachable
 * over HTTP — M5 forbids an endpoint for this however well hidden, because an endpoint that
 * exists is an endpoint that eventually answers in production.
 */
@Injectable()
export class SweepService {
  private readonly logger = new Logger(SweepService.name);
  private readonly tasks = new Map<string, SweepTask>();

  constructor(private readonly clock: Clock) {}

  /**
   * Plugs a task into the sweep. Modules call this from `onModuleInit`.
   *
   * Keyed by name so that registering twice — which happens when a module is imported from two
   * places — replaces rather than duplicates. A duplicated task means every deadline is
   * processed twice per sweep, and for an order cancellation the second pass is the one that
   * produces a confusing error.
   */
  register(task: SweepTask): void {
    if (this.tasks.has(task.sweepName)) {
      this.logger.warn(`Sweep task ${task.sweepName} was registered twice; keeping the latest.`);
    }
    this.tasks.set(task.sweepName, task);
  }

  /**
   * Removes a task. Returns whether there was one to remove.
   *
   * The counterpart to `register`, and the thing that lets a test undo a stand-in it plugged in —
   * without it, a task registered by one test runs in every test after it in the same file, and a
   * deliberately failing stand-in makes an unrelated assertion fail somewhere else.
   */
  unregister(name: string): boolean {
    return this.tasks.delete(name);
  }

  /** Task names currently plugged in, so a test can assert wiring without calling anything. */
  registeredTaskNames(): string[] {
    return [...this.tasks.keys()].sort();
  }

  /**
   * Runs every task against one instant.
   *
   * The instant is read once and passed to all of them. If each task asked the clock itself,
   * a sweep that takes two seconds would evaluate later tasks against a later "now", and a
   * deadline exactly on the boundary would be handled or not depending on how slow the earlier
   * tasks were.
   *
   * A task that throws does not stop the others. A failure in the shipping-quote sweep must not
   * mean nobody's refund deadline is processed today — the clocks are independent, and coupling
   * their failures would turn one bug into a system-wide stall. Failures are logged and surface
   * in the report; the caller decides what to do about them.
   */
  async run(): Promise<SweepReport> {
    const startedAt = this.clock.now();
    const outcomes: SweepTaskOutcome[] = [];

    for (const task of this.tasks.values()) {
      try {
        const handled = await task.runSweep(startedAt);
        outcomes.push({ name: task.sweepName, handled, failed: false });

        if (handled > 0) {
          this.logger.log(`${task.sweepName} handled ${handled}`);
        }
      } catch (error) {
        outcomes.push({ name: task.sweepName, handled: null, failed: true });
        this.logger.error(
          `Sweep task ${task.sweepName} failed; the remaining tasks still ran.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      startedAt,
      outcomes,
      hadFailures: outcomes.some((outcome) => outcome.failed),
    };
  }
}
