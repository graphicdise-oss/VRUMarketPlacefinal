import { Cursor, encodeCursor } from './cursor.js';

/**
 * The envelope every list response uses (M3).
 *
 * `hasMore` exists alongside `nextCursor` even though it is derivable from it. The frontend's
 * "load more" button reads one boolean; making it check `nextCursor !== null` is the same thing
 * spelled less clearly, and a field that costs nothing is worth the clarity at the call site.
 */
export interface Page<T> {
  readonly items: readonly T[];
  /** Pass back to get the next page. Null on the last page. */
  readonly nextCursor: Cursor | null;
  readonly hasMore: boolean;
}

/**
 * Turns a query result into a page.
 *
 * The caller fetches **limit + 1** rows. That extra row is how `hasMore` is known without a
 * second query and without a count: if it came back, there is more. It is then dropped, so the
 * client never sees it.
 *
 * ```ts
 * const rows = await prisma.shop.findMany({
 *   where: cursorFilter(cursor, 'shops'),
 *   orderBy: [{ id: 'desc' }],
 *   take: limit + 1,
 * });
 * return toPage(rows, limit, 'shops');
 * ```
 *
 * Every list but the two chat inboxes is ordered by id (`newestFirst()` / `oldestFirst()`), which
 * UUIDv7 makes chronological, so the cursor needs nothing but the last id. A list that genuinely needs
 * another ordering has to extend the cursor and the keyset filter together, as §108 did for the
 * inboxes (`toActivityPage` · `keysetAfterActivity`) — an earlier version of this
 * function accepted a sort value that no filter ever read, which is a cursor that looks like it
 * supports other orderings while quietly skipping rows.
 */
export function toPage<T extends { id: string }>(
  rows: readonly T[],
  limit: number,
  list: string,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  if (!hasMore || last === undefined) {
    return { items, nextCursor: null, hasMore: false };
  }

  return {
    items,
    nextCursor: encodeCursor({ list, id: last.id }),
    hasMore: true,
  };
}

/** §108: `toPage` for a list ordered by `latestActivityFirst` — the cursor carries the last row's time too. */
export function toActivityPage<T extends { id: string; lastActivityAt: Date }>(rows: readonly T[], limit: number, list: string): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  if (!hasMore || last === undefined) {
    return { items, nextCursor: null, hasMore: false };
  }

  return { items, nextCursor: encodeCursor({ list, id: last.id, at: last.lastActivityAt.toISOString() }), hasMore: true };
}

/**
 * An empty page, for a query that could not match anything.
 *
 * Used where a filter rules everything out before the database is touched — a search for a
 * community that does not exist, say. Returning this rather than running a query that cannot match
 * keeps the response shape identical, which is the whole point of having one envelope.
 */
export function emptyPage<T>(): Page<T> {
  return { items: [], nextCursor: null, hasMore: false };
}
