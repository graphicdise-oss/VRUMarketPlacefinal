/**
 * The numbers this module runs on.
 *
 * `MIN_RATING`/`MAX_RATING` and `MAX_REVIEW_IMAGES` are business rules, settled by K10 (docs/
 * DECISIONS.md) — not ordinary engineering defaults, unlike the length bounds below them.
 * `EDIT_WINDOW_DAYS` is I18's own number.
 */

export const MIN_RATING = 1;
export const MAX_RATING = 5;

/** K10: fewer than a product's 10 — a review photo is evidence for one purchase, not a catalog. */
export const MAX_REVIEW_IMAGES = 5;

/** I18: 7 days, counted from `Review.createdAt` — see that column's own schema comment. */
export const EDIT_WINDOW_DAYS = 7;

export const MAX_REVIEW_TEXT_LENGTH = 2000;

/** L3: the same bounds every other "must explain why" field in this project uses. */
export const MIN_DELETION_REASON_LENGTH = 10;
export const MAX_DELETION_REASON_LENGTH = 500;
