/**
 * The only source of "now" in this system.
 *
 * Seam 2 of M5. Three clocks run in this marketplace — 24 hours for the shop to quote
 * shipping, 24 for the buyer to transfer, 3 days for the shop to confirm — and a stock
 * reservation has to survive all of them, up to about 13 days. A test that cannot move time
 * cannot test any of it, and a system whose central mechanic is untestable is a system nobody
 * can change safely.
 *
 * An abstract class rather than an interface because Nest needs a runtime token to inject
 * against, and `Clock` reads better at the injection site than a `CLOCK` symbol. Domain code
 * depends on this; the implementation is chosen when the module is built.
 *
 * ⚠️ `new Date()` and `Date.now()` are forbidden in src/ by a lint rule, not merely by
 * convention (see eslint.config.mjs). A single direct call is enough to make a deadline
 * untestable, and it will be the one nobody notices until a clock misfires in production.
 */
export abstract class Clock {
  /** The current instant, in UTC. Every timestamp this system stores is UTC (DECISIONS §9). */
  abstract now(): Date;

  /** Milliseconds since the epoch, for arithmetic that does not want a Date. */
  nowMs(): number {
    return this.now().getTime();
  }

  /**
   * `now` plus a number of hours — how every deadline in this system is expressed.
   *
   * Here rather than in each caller so that "24 hours from the quote" is written once. It is
   * also the reason the clock owns time arithmetic at all: a deadline computed from
   * `Date.now()` in one module and from the clock in another produces two different answers
   * during a test, and the disagreement looks like a business-rule bug.
   */
  hoursFromNow(hours: number): Date {
    // Building a Date from a known number rather than reading the wall clock: nowMs() already
    // came through the seam, so this stays testable.
     
    return new Date(this.nowMs() + hours * MS_PER_HOUR);
  }

  daysFromNow(days: number): Date {
    return this.hoursFromNow(days * 24);
  }
}

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * `instant` plus a number of hours (negative to go back) — for #53's sweep, which computes a
 * deadline from a *stored* instant (`Order.createdAt`, `paymentWindowStartedAt`, ...) rather
 * than from `Clock.now()`. `Clock.hoursFromNow` cannot do this: it is always relative to the
 * clock's own current reading, and a sweep task must reason about the exact `now` it was handed,
 * not re-read the clock and risk disagreeing with the sweep that called it.
 */
export function addHours(instant: Date, hours: number): Date {
  // Deriving from a passed-in instant, not the wall clock — see the comment above.
   
  return new Date(instant.getTime() + hours * MS_PER_HOUR);
}

export function addDays(instant: Date, days: number): Date {
  return addHours(instant, days * 24);
}

/**
 * `instant` plus a number of seconds — #63's own use is shifting D5b's dispute-window deadline
 * out by `Order.frozenDurationSeconds`, a value too small to express usefully in whole hours.
 */
export function addSeconds(instant: Date, seconds: number): Date {
   
  return new Date(instant.getTime() + seconds * 1000);
}
