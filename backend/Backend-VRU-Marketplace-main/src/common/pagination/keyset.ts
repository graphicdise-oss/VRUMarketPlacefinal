import { AppException } from '../errors/app-exception.js';
import { Cursor, decodeCursor } from './cursor.js';

/**
 * Where to resume a list, as a Prisma filter.
 *
 * Newest-first is the default ordering across this system (L7), and UUIDv7 makes that free: the
 * first 48 bits of the id are a millisecond timestamp, so `ORDER BY id DESC` is chronological
 * without a second column and without a tie to break. "Everything before this id" is then the
 * whole of the resume condition. (The chat inboxes are the one exception — ordered by latest
 * activity, see `keysetAfterActivity` below, §108.)
 *
 * That is also why #18 is blocked on #15: the ordering guarantee is a property of the id format,
 * not of this file.
 */
export interface KeysetFilter {
  readonly id?: { lt: string } | { gt: string };
}

/**
 * The filter for the next page of a newest-first list.
 *
 * Returns `{}` for the first page so it can be spread into a `where` unconditionally:
 *
 * ```ts
 * where: { ...keysetAfter(cursor, 'shops'), communityId }
 * ```
 *
 * Strictly less-than, never less-than-or-equal. With `lte` the last row of each page reappears as
 * the first row of the next, which is the classic off-by-one a user reads as "the list is
 * duplicating things".
 *
 * Stability under insertion comes for free: a row created while someone is paging gets a *higher*
 * id than any cursor already issued, so it appears on a page the reader has passed rather than
 * pushing everything down by one the way `OFFSET` would.
 */
export function keysetAfter(cursor: Cursor | undefined, list: string): KeysetFilter {
  if (cursor === undefined || cursor === '') {
    return {};
  }

  return { id: { lt: decodeCursor(cursor, list).id } };
}

/**
 * The same thing for a list read oldest-first — chat history, for instance, where the natural
 * reading order is forwards.
 */
export function keysetBefore(cursor: Cursor | undefined, list: string): KeysetFilter {
  if (cursor === undefined || cursor === '') {
    return {};
  }

  return { id: { gt: decodeCursor(cursor, list).id } };
}

/**
 * The ordering that must accompany the filter.
 *
 * Named so a caller cannot accidentally pair a descending filter with an ascending order — which
 * silently returns the same page forever and reads as a broken cursor rather than a wrong ORDER BY.
 *
 * Functions rather than shared constants: each call returns a fresh array. Prisma takes a mutable
 * array, and handing every query the same object is how one caller's sort ends up affecting
 * another's.
 */
export const newestFirst = (): { id: 'desc' }[] => [{ id: 'desc' }];
export const oldestFirst = (): { id: 'asc' }[] => [{ id: 'asc' }];

/**
 * §108: a chat inbox — newest activity first, then newest id among rooms with the same time. The
 * cursor carries both values of the last row, and the filter resumes strictly after that pair, so
 * a room moving to the top while someone pages cannot make another room appear twice or vanish
 * from the pages still to come (it can only move above the page already shown).
 */
export interface ActivityKeysetFilter {
  readonly OR?: ({ lastActivityAt: { lt: Date } } | { lastActivityAt: Date; id: { lt: string } })[];
}

export function keysetAfterActivity(cursor: Cursor | undefined, list: string): ActivityKeysetFilter {
  if (cursor === undefined || cursor === '') {
    return {};
  }

  const { id, at } = decodeCursor(cursor, list);
  if (at === undefined) {
    throw new AppException('VALIDATION_FAILED', {
      message: 'ตำแหน่งของรายการไม่ถูกต้อง กรุณาโหลดรายการใหม่',
      fieldErrors: { cursor: 'cursor is not valid for this list' },
    });
  }
   
  const when = new Date(at);

  return { OR: [{ lastActivityAt: { lt: when } }, { lastActivityAt: when, id: { lt: id } }] };
}

export const latestActivityFirst = (): [{ lastActivityAt: 'desc' }, { id: 'desc' }] => [{ lastActivityAt: 'desc' }, { id: 'desc' }];
