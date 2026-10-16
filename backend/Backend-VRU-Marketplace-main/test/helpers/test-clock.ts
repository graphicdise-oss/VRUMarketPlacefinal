import { Clock, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../../src/time/clock.js';

/**
 * A clock a test can move.
 *
 * This is the second half of seam 2. It lives under test/ and is bound over the `Clock` token in
 * the testing module, so the production wiring has no idea it exists — there is no
 * `NODE_ENV === 'test'` branch anywhere in src/, and therefore no code path that could be
 * switched on in production.
 *
 * ⚠️ The time is moved from inside the test process, never over HTTP. M5 forbids an endpoint for
 * advancing the clock however well hidden, because an endpoint that exists is one that can
 * eventually be reached — and an attacker who can move this system's clock can expire a stock
 * reservation out from under a buyer who has already transferred the money.
 */
export class TestClock extends Clock {
  private readonly start: Date;
  private current: Date;

  /**
   * Starts at a fixed instant rather than the real now, so a failure is reproducible and a test
   * asserting on a date does not behave differently in a different week. The value is arbitrary
   * but deliberately not midnight and not a month boundary — those are the places an off-by-one
   * hides.
   */
  constructor(start: Date = new Date('2026-03-17T09:42:11.000Z')) {
    super();
    this.start = new Date(start.getTime());
    this.current = new Date(start.getTime());
  }

  now(): Date {
    // A copy, so a caller that mutates the Date it was handed cannot move the clock by accident.
    return new Date(this.current.getTime());
  }

  /** Moves time forward. Negative values are rejected: nothing in this system goes backwards. */
  advanceBy(milliseconds: number): void {
    if (milliseconds < 0) {
      throw new RangeError(
        `TestClock cannot go backwards (asked for ${milliseconds}ms). If a test needs an earlier ` +
          'instant, construct the clock at that instant instead.',
      );
    }
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  advanceByMinutes(minutes: number): void {
    this.advanceBy(minutes * MS_PER_MINUTE);
  }

  /** The unit the three clocks are written in: 24 hours, 24 hours, 3 days. */
  advanceByHours(hours: number): void {
    this.advanceBy(hours * MS_PER_HOUR);
  }

  advanceByDays(days: number): void {
    this.advanceBy(days * MS_PER_DAY);
  }

  /** Jumps to a specific instant, for a test that needs a particular date. */
  setTo(instant: Date): void {
    this.current = new Date(instant.getTime());
  }

  /**
   * Back to the starting instant. `setupTestApp()` calls this before each test.
   *
   * Without it, a test that advances three days leaves the clock three days ahead for every test
   * after it in the same file — and the one that fails is an unrelated test later on, which is
   * the same class of bug as a leaked spy or a row left in the database.
   */
  resetToStart(): void {
    this.current = new Date(this.start.getTime());
  }
}
