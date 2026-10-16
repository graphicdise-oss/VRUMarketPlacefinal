import { AppException } from '../src/common/errors/app-exception.js';
import { newId } from '../src/common/id.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from '../src/common/pagination/cursor.js';
import { keysetAfter, newestFirst } from '../src/common/pagination/keyset.js';
import { emptyPage, toPage } from '../src/common/pagination/page.js';
import { setupTestApp } from './helpers/test-app.js';

/**
 * #18 says in as many words that topic 1 has no endpoint returning a list, so the envelope cannot
 * be proven end to end here, and that opening `audit_log` for reading without the admin guard
 * topic 3 builds would be a hole rather than a test. The first list in topic 2 is what proves it
 * over HTTP — and is required to use this envelope rather than inventing one.
 *
 * What is provable here is everything that does not need a route: the codec, the clamping, the
 * envelope's arithmetic, and — against the real database — the property most likely to be wrong,
 * which is that paging neither skips nor repeats a row when the table changes underneath.
 *
 * These are pure functions plus the test's own Prisma access, which `TestApp` already exists to
 * provide for arranging and asserting. No application service is called.
 */
describe('the cursor', () => {
  it('round-trips a position', () => {
    const id = newId();

    expect(decodeCursor(encodeCursor({ list: 'shops', id }), 'shops')).toEqual({
      list: 'shops',
      id,
    });
  });

  it('carries nothing but the list and the id', () => {
    const id = newId();

    // No secondary sort value: every list is ordered by id, which UUIDv7 makes chronological. A
    // cursor carrying a sort value that no filter reads is a cursor that looks like it supports
    // other orderings and silently skips rows — so the field is absent rather than unused.
    expect(Object.keys(decodeCursor(encodeCursor({ list: 'shops', id }), 'shops')).sort()).toEqual([
      'id',
      'list',
    ]);
  });

  it('looks like nothing in particular to a client', () => {
    const cursor = encodeCursor({ list: 'shops', id: newId() });

    // Opaque in the sense that matters: it does not read as a position a client could increment.
    // It is not signed, and FRONTEND-NOTES does not pretend otherwise.
    expect(cursor).not.toMatch(/shops/);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects a tampered cursor as a validation failure, not a 500', () => {
    const cursor = encodeCursor({ list: 'shops', id: newId() });
    const mangled = `${cursor.slice(0, -4)}zzzz`;

    // The alternative — decoding to something that happens to parse and returning that page — is
    // the "returns nonsense" outcome #18 rules out.
    expect(() => decodeCursor(mangled, 'shops')).toThrow(AppException);
  });

  it('rejects a cursor issued for a different list', () => {
    const cursor = encodeCursor({ list: 'orders', id: newId() });

    // Pasting an order cursor into the product list would otherwise return a position that means
    // nothing there. With the list name checked, it is a clear 400.
    expect(() => decodeCursor(cursor, 'products')).toThrow(AppException);
  });

  it('rejects a cursor whose id is not a uuid', () => {
    const cursor = encodeCursor({ list: 'shops', id: 'not-an-id' });

    expect(() => decodeCursor(cursor, 'shops')).toThrow(AppException);
  });

  it('rejects plausible hand-made cursors', () => {
    for (const attempt of ['', '1', 'MQ', 'eyJwYWdlIjoyfQ', 'null', Buffer.from('{}').toString('base64url')]) {
      expect(() => decodeCursor(attempt, 'shops')).toThrow(AppException);
    }
  });

  it('fails in the project error shape with the field named', () => {
    try {
      decodeCursor('garbage', 'shops');
      expect.unreachable('decodeCursor should have thrown');
    } catch (error) {
      // Standard code (#16) so the frontend's single handler covers it, and a Thai message a user
      // can act on — reload the list.
      expect(error).toBeInstanceOf(AppException);
      const failure = error as AppException;
      expect(failure.code).toBe('VALIDATION_FAILED');
      expect(failure.fieldErrors).toHaveProperty('cursor');
      expect(failure.message).toMatch(/[฀-๿]/);
    }
  });
});

describe('page size (I17)', () => {
  it('defaults to 20 when not asked for', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('clamps above the maximum instead of rejecting', () => {
    // #18 is explicit: clamp, do not error. A client asking for 200 wants as much as it can get,
    // and a 400 it cannot act on turns a performance limit into a broken screen.
    expect(clampPageSize(200)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(Number.MAX_SAFE_INTEGER)).toBe(MAX_PAGE_SIZE);
  });

  it('honours a size within range', () => {
    expect(clampPageSize(7)).toBe(7);
    expect(clampPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it('falls back to the default for sizes that mean no page at all', () => {
    // Zero and negative are different in kind from "too many": there is no such page, so there is
    // nothing to clamp towards.
    for (const nonsense of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampPageSize(nonsense)).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it('truncates a fractional size rather than handing it to the database', () => {
    expect(clampPageSize(10.9)).toBe(10);
  });
});

describe('the envelope (M3)', () => {
  const rowsOf = (count: number): { id: string }[] =>
    Array.from({ length: count }, () => ({ id: newId() }));

  it('has exactly items, nextCursor and hasMore', () => {
    const page = toPage(rowsOf(3), 20, 'shops');

    // The absence of `total` and `page` is part of the contract, so it is asserted rather than
    // assumed. A well-meaning addition later is the thing this catches.
    expect(Object.keys(page).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
  });

  it('reports the last page with a null cursor', () => {
    const page = toPage(rowsOf(5), 20, 'shops');

    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('drops the extra row used to detect a next page', () => {
    // The caller fetches limit + 1. That extra row is how hasMore is known without a second query
    // and without a count — and the client must never see it.
    const rows = rowsOf(21);
    const page = toPage(rows, 20, 'shops');

    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.items.at(-1)?.id).toBe(rows[19]?.id);
    expect(page.items.map((item) => item.id)).not.toContain(rows[20]?.id);
  });

  it('points its cursor at the last item returned, not the row it dropped', () => {
    const rows = rowsOf(21);
    const page = toPage(rows, 20, 'shops');

    // Pointing at the dropped row would skip it entirely on the next page.
    const resumeFrom = decodeCursor(page.nextCursor ?? '', 'shops');
    expect(resumeFrom.id).toBe(rows[19]?.id);
  });

  it('treats an exactly-full page with nothing beyond it as the last page', () => {
    // The off-by-one that shows a "load more" button leading to an empty list.
    const page = toPage(rowsOf(20), 20, 'shops');

    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty result', () => {
    expect(toPage([], 20, 'shops')).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(emptyPage()).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
});

describe('paging a real table neither skips nor repeats', () => {
  const getApp = setupTestApp();

  /** audit_log is the only table that exists in topic 1, and it has an id — which is all keyset
   * pagination needs. The rows are written directly because this is arranging data, not exercising
   * the audit writer. */
  async function seed(count: number): Promise<void> {
    const { prisma } = getApp();

    for (let index = 0; index < count; index += 1) {
      await prisma.auditLog.create({
        data: {
          id: newId(),
          actorUserId: null,
          action: 'SHOP_APPROVED',
          targetType: 'SHOP',
          targetId: null,
        },
      });
    }
  }

  async function pageThrough(limit: number, insertAfterFirstPage = 0): Promise<string[]> {
    const { prisma } = getApp();
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const rows = await prisma.auditLog.findMany({
        where: { ...keysetAfter(cursor, 'audit') },
        orderBy: newestFirst(),
        take: limit + 1,
      });

      const page = toPage(rows, limit, 'audit');
      seen.push(...page.items.map((row) => row.id));

      pages += 1;
      if (pages === 1 && insertAfterFirstPage > 0) {
        // Rows arriving mid-read are the normal case in a marketplace, not an edge case.
        await seed(insertAfterFirstPage);
      }

      if (!page.hasMore) {
        return seen;
      }
      cursor = page.nextCursor ?? undefined;

      // A runaway loop would otherwise hang the suite rather than fail it.
      expect(pages).toBeLessThan(50);
    }
  }

  it('returns every row exactly once across pages', async () => {
    await seed(25);

    const seen = await pageThrough(10);

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('returns them newest first, which UUIDv7 gives for free', async () => {
    await seed(12);

    const seen = await pageThrough(5);

    // Ordering by id alone is chronological because the first 48 bits of a UUIDv7 are a
    // millisecond timestamp. That is why there is no second sort column and no tie to break —
    // and why #18 waited for #15.
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('does not repeat or skip a row when new rows arrive between pages', async () => {
    await seed(15);

    // Five rows are inserted after the first page is read. With OFFSET, they would push the
    // unread rows down and the reader would see page one's tail a second time. Keyset resumes
    // from an exact id, so the new rows land above the cursor and are simply not in this read.
    const seen = await pageThrough(5, 5);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(15);
  });

  it('rejects a cursor from another list before it reaches the database', async () => {
    await seed(3);
    const { prisma } = getApp();

    const foreign = encodeCursor({ list: 'orders', id: newId() });

    // The guard is in the filter builder, so a wrong cursor cannot turn into a query that quietly
    // returns the wrong window.
    expect(() =>
      prisma.auditLog.findMany({ where: { ...keysetAfter(foreign, 'audit') } }),
    ).toThrow(AppException);
  });
});
