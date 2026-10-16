import { AppException } from '../errors/app-exception.js';
import { isUuid } from '../id.js';

/**
 * Cursor pagination, for every long list in this system.
 *
 * M3 fixed the envelope and, just as importantly, what is *not* in it: no `total` and no `page`.
 * Cursor pagination cannot produce an accurate count cheaply — a `COUNT(*)` over a filtered set
 * scans it — and a count that is either slow or wrong is worse than no count. The frontend is
 * told to build "load more" rather than page numbers (FRONTEND-NOTES).
 *
 * The cursor is a position, not an offset. `OFFSET 40` re-reads forty rows and, worse, shifts when
 * a row is inserted above: the user sees an item twice, or never sees it at all. Keyset pagination
 * asks for "the rows after this exact one", which is stable under insertion.
 */

/** What a cursor actually carries. Never exposed — clients see the encoded string. */
interface CursorPayload {
  /**
   * Which list this cursor came from.
   *
   * Without it, a cursor taken from the order list would be accepted by the product list and
   * silently return a position that means nothing there — which is the "returns nonsense" outcome
   * #18 rules out. With it, the mismatch is a validation error.
   */
  readonly list: string;

  /**
   * The id of the last row on the previous page.
   *
   * The only thing a cursor carries, because every list in this system is ordered by id — which
   * UUIDv7 makes chronological. There is deliberately no secondary sort value: carrying one without
   * a keyset helper that *uses* it produced a cursor that looked like it supported other orderings
   * and silently skipped rows, so the field was removed rather than left half-built. A list that
   * genuinely needs a different ordering adds the field and the matching filter together.
   */
  readonly id: string;

  /**
   * §108: the last row's `lastActivityAt`, for the one kind of list ordered by something other than
   * id — a chat inbox, newest activity first. Added together with the filter that uses it
   * (`keysetAfterActivity`), as the note on `id` above asks.
   */
  readonly at?: string;
}

/**
 * A position in a list, as the client sees it: an opaque string.
 *
 * Deliberately not signed. Signing was considered and rejected: nothing is authorised by a
 * cursor — the list's own guard decides what the caller may see, and it runs whether a cursor was
 * supplied or not — so a forged cursor can only move someone to a different page of data they were
 * already allowed to read. Adding an HMAC would mean key management and a non-pure codec for no
 * security gain.
 *
 * ⚠️ If a cursor ever needs to carry something the client should not see, or something the query
 * trusts without re-checking, that reasoning expires and this needs signing. Base64 is encoding,
 * not protection.
 */
export type Cursor = string;

export function encodeCursor(payload: CursorPayload): Cursor {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Reads a cursor, rejecting anything that is not one this list issued.
 *
 * Throws `AppException('VALIDATION_FAILED')`, so a mangled cursor comes back as a 400 in the
 * project's error shape with `fieldErrors.cursor` — never a 500, and never a page of unrelated
 * rows. A client that kept a cursor across a deploy, or pasted one from another screen, gets a
 * clear answer rather than confusing data.
 *
 * The message says nothing about the cursor's internals. It is not a secret, but telling a caller
 * which field failed to parse teaches them to construct one, and the only supported way to get a
 * cursor is to be given it.
 */
export function decodeCursor(cursor: Cursor, list: string): CursorPayload {
  const payload = tryDecode(cursor);

  if (payload === null || payload.list !== list || !isUuid(payload.id)) {
    throw new AppException('VALIDATION_FAILED', {
      message: 'ตำแหน่งของรายการไม่ถูกต้อง กรุณาโหลดรายการใหม่',
      fieldErrors: { cursor: 'cursor is not valid for this list' },
    });
  }

  return payload;
}

function tryDecode(cursor: Cursor): CursorPayload | null {
  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

    if (typeof json !== 'object' || json === null) {
      return null;
    }

    const candidate = json as Record<string, unknown>;
    const { list, id, at } = candidate;

    if (typeof list !== 'string' || typeof id !== 'string') {
      return null;
    }
    if (at !== undefined && (typeof at !== 'string' || Number.isNaN(Date.parse(at)))) {
      return null;
    }

    return at === undefined ? { list, id } : { list, id, at };
  } catch {
    // Not base64, or not JSON. Both mean the same thing to the caller: not a cursor we issued.
    return null;
  }
}

/** Page size rules from I17. Exported so a DTO and a test cannot drift from each other. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/**
 * Brings a requested page size into range.
 *
 * Clamps rather than rejects, as #18 requires. A client asking for 200 wants as much as it can
 * get; answering 400 turns a performance boundary into a broken screen, and the client cannot do
 * anything useful with the error except ask again for 50. Asking for 0 or a negative is different
 * in kind — there is no such page — so it falls back to the default.
 */
export function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.trunc(requested), MAX_PAGE_SIZE);
}
