import { Injectable, OnModuleInit } from '@nestjs/common';
import { SweepTask } from '../time/sweep.js';
import { SweepService } from '../time/sweep.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { SessionService } from './session.service.js';
import { VerificationTokenService } from './verification-token.service.js';

/*
 * The three tidy-up clocks this topic plugs into the one sweep point. They are here rather than in
 * three files because they are the same kind of thing — state that outlived its purpose — and a
 * reader who wants to know what auth leaves behind should find the whole answer at once.
 */

/**
 * Removes sessions whose refresh token has expired.
 *
 * Plugged into the one sweep point (seam 2) rather than given a cron of its own, which M5 forbids
 * outright: every clock in this system is evaluated by one `sweep.run()`, so a test that moves the
 * clock tests all of them at once.
 *
 * Without this the session table only ever grows. Nothing breaks when it does — a dead row cannot
 * authorise anything, because `rotate` checks the expiry — but a table that accumulates a row per
 * login per device forever is an index that gets slower at the exact rate the site gets used, on a
 * server that is already short on memory.
 *
 * A row is removed rather than kept for a grace period: once the refresh token has expired the
 * session cannot be revived, so there is nothing left to learn from it, and a grace period would
 * be a number nobody decided.
 */
@Injectable()
export class SessionSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'sessions.removeExpired';

  constructor(
    private readonly sessions: SessionService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  runSweep(now: Date): Promise<number> {
    return this.sessions.deleteExpired(now);
  }
}

/**
 * Removes verification and reset links that have expired.
 *
 * A second task rather than a second job inside the first: SweepService isolates failures per
 * task, so a broken query here cannot stop sessions from being cleaned up, and the report says
 * which of the two did the work. They are separate clocks that happen to be tidy-ups.
 *
 * Expired links matter more than expired sessions do. Every row is the hash of something that was
 * emailed to a person, and the table grows by one every time anybody registers or presses
 * "resend" — while an expired row can no longer be spent, keeping it forever means keeping a
 * record of who asked for what and when, for no purpose.
 */
@Injectable()
export class VerificationTokenSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'verificationTokens.removeExpired';

  constructor(
    private readonly tokens: VerificationTokenService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  runSweep(now: Date): Promise<number> {
    return this.tokens.deleteExpired(now);
  }
}

/**
 * Drops rate-limit counters whose window has closed.
 *
 * The only one of the three that tidies memory rather than rows, and the only one whose absence
 * would be a leak rather than a growing table: every distinct (source, address) pair that has ever
 * tried to sign in keeps an entry until something removes it, and an attacker can mint those pairs
 * as fast as they can invent addresses.
 *
 * The cutoff belongs to the rules, not to this task, so it is not passed in — see `pruneExpired`
 * for the bug that taught us that.
 */
@Injectable()
export class RateLimitSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'rateLimits.removeClosedWindows';

  constructor(
    private readonly counters: RateLimitService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  runSweep(now: Date): Promise<number> {
    return this.counters.pruneExpired(now.getTime());
  }
}
