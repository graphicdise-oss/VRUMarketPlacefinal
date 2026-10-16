import { vi } from 'vitest';
import type { TestApp } from './test-app.js';

/**
 * The few ways a race test arranges two requests to meet at a chosen moment (§91 onward) — shared
 * here since §115, after the same bodies had been copied into four spec files. Every one works
 * through seam 1 (M5): a spy on the app's own `$transaction`, and Postgres's own view of who is
 * waiting on a lock. Nothing here calls a service.
 */

/**
 * Waits until some connection is blocked on a row lock — the moment a request started in a hook
 * has queued behind the transaction the test paused. Throws if that never happens, so a test whose
 * interleaving silently stopped occurring fails instead of passing.
 */
export async function untilSomeoneWaitsOnALock(app: TestApp): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await someoneWaitsOnALock(app)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('No request ever queued behind the lock — the interleaving this test needs did not happen.');
}

/**
 * Lets a request started in a hook run until it either finishes or queues behind a lock — for a
 * test whose fixed code lets it finish where the old code made it wait (§114). Neither within 5 s
 * means the interleaving did not happen, which fails the test rather than passing it.
 */
export async function untilSettledOrWaiting(app: TestApp, request: Promise<unknown>): Promise<void> {
  let settled = false;
  void request.finally(() => {
    settled = true;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (settled || (await someoneWaitsOnALock(app))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The request neither finished nor queued behind a lock — the interleaving this test needs did not happen.');
}

async function someoneWaitsOnALock(app: TestApp): Promise<boolean> {
  const [row] = await app.prisma.$queryRaw<{ waiting: bigint }[]>`
    SELECT count(*)::bigint AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
  `;

  return (row?.waiting ?? 0n) > 0n;
}

/**
 * Runs `hook` inside the next interactive transaction, right after its `nth` raw query returns —
 * i.e. while that transaction holds whatever that query locked.
 */
export function pauseNextTransactionAfterRawQuery(app: TestApp, nth: number, hook: () => Promise<void>): void {
  const original = app.prisma.$transaction.bind(app.prisma) as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(app.prisma, '$transaction').mockImplementationOnce((async (callback: (tx: unknown) => Promise<unknown>, options?: unknown) => {
    let seen = 0;
    return original(async (tx: Record<string, unknown>) => {
      const paused = new Proxy(tx, {
        get(target, property) {
          if (property !== '$queryRaw') {
            return Reflect.get(target, property) as unknown;
          }
          return async (...args: unknown[]) => {
            const result = await (target.$queryRaw as (...a: unknown[]) => Promise<unknown>)(...args);
            seen += 1;
            if (seen === nth) {
              await hook();
            }
            return result;
          };
        },
      });
      return callback(paused);
    }, options);
  }) as never);
}

/**
 * Runs `interloper` to completion just before the next `$transaction` the app opens — the moment
 * the request under test has done its reads outside the transaction and is about to write.
 */
export function beforeNextTransaction(app: TestApp, interloper: () => Promise<unknown>): void {
  const original = app.prisma.$transaction.bind(app.prisma) as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(app.prisma, '$transaction').mockImplementationOnce((async (...args: unknown[]) => {
    await interloper();
    return original(...args);
  }));
}
