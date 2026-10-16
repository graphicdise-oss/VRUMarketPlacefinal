/**
 * The numbers this module runs on. D5b's two windows are business rules (docs/DECISIONS.md);
 * the length bounds below them are ordinary engineering defaults, the same shape review/shop
 * reasons already use throughout this project.
 */

/** I17: the file cap, per side (buyer's opening evidence, shop's own response evidence). */
export const MAX_EVIDENCE_FILES = 10;

export const MIN_DISPUTE_REASON_LENGTH = 10;
export const MAX_DISPUTE_REASON_LENGTH = 2000;

export const MIN_SHOP_RESPONSE_LENGTH = 10;
export const MAX_SHOP_RESPONSE_LENGTH = 2000;

/** D5b: hard stop counted from `Order.completedAt` — whichever of this and the other window below comes first. */
export const DISPUTE_WINDOW_AFTER_RECEIVED_DAYS = 7;

/** D5b: hard stop counted from `Order.shippedAt` — covers the buyer who never clicks "received". */
export const DISPUTE_WINDOW_AFTER_SHIPPED_DAYS = 15;

/** §85: hard stop counted from `Order.cancelledAt` — a cancelled order the buyer had paid on can be disputed this long, not forever. */
export const DISPUTE_WINDOW_AFTER_CANCELLED_DAYS = 15;
