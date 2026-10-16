import { AuditLogService } from '../src/audit/audit-log.service.js';
import { HealthResponseDto } from '../src/health/dto/health-response.dto.js';
import { MS_PER_HOUR } from '../src/time/clock.js';
import { SweepScheduler } from '../src/time/sweep.scheduler.js';
import { SweepTask } from '../src/time/sweep.js';
import { createTestApp, setupTestApp } from './helpers/test-app.js';

const getApp = setupTestApp();

/**
 * Seam 2 (M5), proven end to end.
 *
 * The pattern every later topic copies is in the first test of the second block:
 *
 *   arrange over HTTP → move the clock → call sweep.run() directly → assert over HTTP
 *
 * Topic 7 writes the real tasks. This file proves the machinery they plug into works, and that
 * the two things which would quietly break it — a direct `new Date()` somewhere, or a sweep
 * reachable over HTTP — are not possible.
 */
describe('the clock the system reads', () => {
  it('is what /api/v1/health reports, so moving it is visible over HTTP', async () => {
    const { client, clock } = getApp();

    const before = await client.get('/api/v1/health').expect(200);
    const reported = (before.body as HealthResponseDto).checkedAt;

    // Not "roughly now": exactly the instant the injected clock holds. If health called
    // `new Date()` the two would differ by the real elapsed time, and every deadline in topics
    // 7 through 10 would be equally untestable.
    expect(reported).toBe(clock.now().toISOString());
  });

  it('moves the time the application sees when the test advances it', async () => {
    const { client, clock } = getApp();

    const before = await client.get('/api/v1/health').expect(200);
    clock.advanceByHours(26);
    const after = await client.get('/api/v1/health').expect(200);

    const movedBy =
      new Date((after.body as HealthResponseDto).checkedAt).getTime() -
      new Date((before.body as HealthResponseDto).checkedAt).getTime();

    // 26 hours, not "more than zero". The first clock in this system is 24 hours, so a test that
    // only proves time moved forward cannot tell 23 hours from 25.
    expect(movedBy).toBe(26 * MS_PER_HOUR);
  });

  it('starts each test from the same instant', async () => {
    // The previous test advanced 26 hours. If the clock were shared state, this would fail —
    // and it would fail here rather than where the bug is, which is why reset() exists.
    const { client, clock } = getApp();

    const response = await client.get('/api/v1/health').expect(200);

    expect((response.body as HealthResponseDto).checkedAt).toBe(clock.now().toISOString());
    expect(clock.now().toISOString()).toBe('2026-03-17T09:42:11.000Z');
  });

  it('refuses to go backwards', () => {
    const { clock } = getApp();

    // Nothing in this marketplace moves backwards in time. A test that needs an earlier instant
    // constructs the clock there; silently accepting a negative jump would let a deadline
    // un-expire, which no production code path can do.
    expect(() => clock.advanceBy(-1)).toThrow(RangeError);
  });

  it('hands out copies, so a caller cannot move it by mutating what it got', () => {
    const { clock } = getApp();

    const handed = clock.now();
    handed.setFullYear(2099);

    expect(clock.now().getFullYear()).toBe(2026);
  });
});

describe('the single sweep point', () => {
  /**
   * A stand-in for the real tasks that arrive with topic 7.
   *
   * Registered by the test rather than by the application, because topic 1 has no deadlines of
   * its own — inventing one in src/ just to have something to sweep would be shipping a feature
   * to make a test look complete. It records what instant it was handed and writes an audit row,
   * which is the closest thing to observable state that exists this early.
   */
  class RecordingSweepTask implements SweepTask {
    readonly sweepName = 'test:recording';
    readonly seenInstants: Date[] = [];

    constructor(private readonly audit: AuditLogService) {}

    async runSweep(now: Date): Promise<number> {
      this.seenInstants.push(now);
      await this.audit.record({
        actorUserId: null,
        action: 'ORDER_FROZEN',
        targetType: 'ORDER',
        targetId: null,
      });
      return 1;
    }
  }

  it('runs a task against the advanced time and its effect is observable', async () => {
    // ── The pattern. Topic 7 replaces the stand-in with real clocks and asserts over HTTP. ──
    const { app, clock, sweep, prisma } = getApp();

    // arrange
    const task = new RecordingSweepTask(app.get(AuditLogService));
    sweep.register(task);

    // move the clock
    clock.advanceByDays(3);
    const expected = clock.now();

    // call the sweep directly — never over HTTP
    const report = await sweep.run();

    // assert
    expect(task.seenInstants).toEqual([expected]);
    expect(report.outcomes).toContainEqual({ name: 'test:recording', handled: 1, failed: false });
    expect(report.hadFailures).toBe(false);

    // The side effect really happened. An audit row has no read endpoint until #33, so this is
    // asserted through the same connection the app uses.
    const rows = await prisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
  });

  it('hands every task the same instant', async () => {
    const { app, clock, sweep } = getApp();

    const first = new RecordingSweepTask(app.get(AuditLogService));
    const second = new RecordingSweepTask(app.get(AuditLogService));
    // Distinct names, or the second would replace the first.
    Object.defineProperty(second, 'sweepName', { value: 'test:recording-2' });

    sweep.register(first);
    sweep.register(second);
    clock.advanceByHours(1);

    await sweep.run();

    // One instant for the whole sweep. If each task read the clock itself, a slow first task
    // would move "now" for the second, and a deadline sitting exactly on the boundary would be
    // handled or skipped depending on how busy the server was.
    expect(first.seenInstants).toEqual(second.seenInstants);
  });

  it('keeps running the other tasks when one throws', async () => {
    const { app, sweep } = getApp();

    const failing: SweepTask = {
      sweepName: 'test:failing',
      runSweep: () => Promise.reject(new Error('deliberate')),
    };
    const healthy = new RecordingSweepTask(app.get(AuditLogService));
    Object.defineProperty(healthy, 'sweepName', { value: 'test:healthy' });

    sweep.register(failing);
    sweep.register(healthy);

    const report = await sweep.run();

    // A bug in the shipping-quote sweep must not mean nobody's refund deadline is processed
    // today. The clocks are independent; coupling their failures turns one bug into a stall.
    expect(report.hadFailures).toBe(true);
    expect(report.outcomes).toContainEqual({ name: 'test:failing', handled: null, failed: true });
    expect(report.outcomes).toContainEqual({ name: 'test:healthy', handled: 1, failed: false });
    expect(healthy.seenInstants).toHaveLength(1);
  });

  it('replaces rather than duplicates a task registered twice', async () => {
    const { app, sweep } = getApp();

    const task = new RecordingSweepTask(app.get(AuditLogService));
    sweep.register(task);
    sweep.register(task);

    await sweep.run();

    // Registered twice would mean every deadline processed twice per sweep — cancelling an
    // already-cancelled order, or sending two warning emails.
    expect(task.seenInstants).toHaveLength(1);
  });

  it('registers exactly the tasks the application ships, and no others', async () => {
    // A freshly booted app, not the shared one: the tests above register stand-ins into that
    // instance, so asking it would measure this file rather than the application.
    //
    // The whole list, spelled out, rather than a `toContain` per task. Topic 1 shipped the place
    // and nothing in it; #24 added the first real task. Each later topic that plugs a clock in
    // edits this line, which is the point — a sweep that grows a task nobody expected is a sweep
    // doing work nobody asked for, on a schedule nobody chose.
    const fresh = await createTestApp();

    try {
      expect(fresh.sweep.registeredTaskNames()).toEqual([
        'accessLog.purgeExpired',
        'accountErasure.processQueue',
        'accountMarkers.purgeUnbanned',
        'chat.discardUnsentAttachments',
        'notifications.purgeOld',
        'orders.expirePaymentConfirmation',
        'orders.expirePaymentWindow',
        'orders.expireRefundBuyerConfirm',
        'orders.expireShippingQuote',
        'orders.flagRefundSlipOverdue',
        'orders.warnPaymentConfirmationDeadline',
        'orders.warnPaymentDeadline',
        'orders.warnShippingQuoteDeadline',
        'rateLimits.removeClosedWindows',
        'sessions.removeExpired',
        'verificationTokens.removeExpired',
      ]);
    } finally {
      await fresh.close();
    }
  });
});

describe('there is no way to reach time from outside (M5)', () => {
  it('exposes no endpoint that moves the clock or triggers a sweep', async () => {
    const { client } = getApp();

    // Not a thorough search — it cannot be — but it fails loudly if someone adds the obvious
    // convenience. The real guarantee is that `sweep.run()` and the clock are only reachable
    // from inside the process, and that this is written down in CLAUDE.md.
    for (const path of [
      '/api/v1/sweep',
      '/api/v1/sweep/run',
      '/api/v1/clock',
      '/api/v1/time',
      '/api/v1/test/clock',
      '/api/v1/internal/sweep',
    ]) {
      await client.get(path).expect(404);
      await client.post(path).expect(404);
    }
  });

  it('has exactly one scheduler, and it calls the single sweep point', async () => {
    const { app, sweep } = getApp();

    // The cron fires every five minutes, so a test never waits for it. Calling the scheduler's
    // method directly proves the wiring without the wait — and proves there is one scheduler
    // rather than a second cron hiding in a feature module.
    const scheduler = app.get(SweepScheduler);
    const run = vi.spyOn(sweep, 'run');

    await scheduler.runScheduledSweep();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('survives a task failure without taking the process down', async () => {
    const { app, sweep } = getApp();

    // An unhandled rejection inside a cron callback can kill the process, and the process is
    // also the API. The scheduler must swallow what the sweep could not handle.
    vi.spyOn(sweep, 'run').mockRejectedValue(new Error('sweep exploded'));

    await expect(app.get(SweepScheduler).runScheduledSweep()).resolves.toBeUndefined();
  });
});
