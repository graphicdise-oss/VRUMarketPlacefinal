import { newId } from '../common/id.js';

/**
 * The overwrite values PDPA erasure (#70, G3) writes in place of PII — never `null` where the
 * column is `NOT NULL` (`Order`'s address snapshot), and never a value that could pass for real
 * data. Centralised so every table gets the same words rather than each write site inventing its
 * own — a reviewer checking "does this look erased" only has to recognise one pattern.
 *
 * The exact wording is this ticket's own call (the AC leaves it open: "เลือกได้เองแต่เขียนเหตุผลไว้
 * ในโค้ด") — Thai, in parentheses, unmistakably a system message rather than something a real
 * person would type into a name or address field. `docs/FRONTEND-NOTES.md` documents these same
 * values so a frontend can recognise them too, rather than rendering them as if they were real.
 */
export const ERASED_NAME_PLACEHOLDER = '(ผู้ใช้ขอลบข้อมูลตาม PDPA)';
export const ERASED_PHONE_PLACEHOLDER = '0000000000';
export const ERASED_LINE_PLACEHOLDER = '(ข้อมูลถูกลบ)';
export const ERASED_POSTAL_CODE_PLACEHOLDER = '00000';

/**
 * A unique, obviously-fake email for the now-erased `User` row to carry forward. `.invalid` is
 * the reserved TLD RFC 2606 sets aside for exactly this — an address that will never resolve and
 * is never meant to receive mail — so this can never collide with a real registration, and unlike
 * `deleted+<uuid>@example.com` it does not borrow a domain anyone else could plausibly own.
 * `newId()` guarantees no two erased accounts ever produce the same address, satisfying `email`'s
 * own `@unique` constraint without needing to touch it.
 */
export function erasedEmailPlaceholder(): string {
  return `deleted-${newId()}@erased.invalid`;
}

/** #70's own H8: what a message's `content` becomes once its sender is erased. */
export const ERASED_CHAT_MESSAGE_PLACEHOLDER = '(ข้อความถูกลบตามคำขอของผู้ส่งตาม PDPA)';

/**
 * #73 (N4/N27): what a shop's `name` becomes once its owner is erased — the column #71 could not
 * overwrite because it did not exist yet (see that ticket's own comment, and `docs/DECISIONS.md`
 * §60/N27). Same style as every other placeholder here: Thai, parenthetical, unmistakably a
 * system message rather than something a real shop owner would type as a shop's name.
 */
export const ERASED_SHOP_NAME_PLACEHOLDER = '(ร้านนี้ถูกลบข้อมูลตาม PDPA)';

/**
 * §84 (the project owner's choice): what a dispute's `reason` or `shopResponse` becomes once the
 * person who wrote it is erased — H8's own rule for chat, applied to the other place a person
 * types free text about an order. The ruling itself (`rulingReason`, written by an admin) stays,
 * as G3 keeps "คำตัดสินข้อพิพาท".
 */
export const ERASED_DISPUTE_TEXT_PLACEHOLDER = '(ข้อความถูกลบตามคำขอของผู้เขียนตาม PDPA)';

/**
 * §96 (the project owner's choice): what the rest of a buyer's own free text becomes once they are
 * erased — a review's text, their reason for cancelling, their reason for rejecting a shipping fee.
 * The same rule as `ERASED_DISPUTE_TEXT_PLACEHOLDER`, and deliberately the same words.
 */
export const ERASED_BUYER_TEXT_PLACEHOLDER = ERASED_DISPUTE_TEXT_PLACEHOLDER;
