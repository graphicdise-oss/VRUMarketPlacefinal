/**
 * Invariant 3's three clocks and their I17 warning lead times — the one place both
 * `order-sweep.tasks.ts` (when the sweep acts) and `OrderDto.expiresAt` (the countdown a buyer or
 * shop sees) read these from. Code review of topic 7 (§81): the two used to keep their own copies
 * with a comment asking them to "stay in lockstep", which is a promise nobody enforces.
 */
export const SHIPPING_QUOTE_WINDOW_HOURS = 24;
export const PAYMENT_WINDOW_HOURS = 24;
export const PAYMENT_CONFIRMATION_WINDOW_DAYS = 3;

export const SHIPPING_QUOTE_WARNING_LEAD_HOURS = 6;
export const PAYMENT_WARNING_LEAD_HOURS = 6;
export const PAYMENT_CONFIRMATION_WARNING_LEAD_HOURS = 24;

/**
 * §81: money columns on `Order` are Postgres `integer` (satang), so anything past 2,147,483,647
 * (~21.47 million baht) cannot be stored at all — before these caps existed it reached the
 * database and came back as a 500. Two caps, sized so their sum always fits:
 *
 * - a shipping fee is at most 100,000 baht — far beyond any real parcel, low enough to catch an
 *   extra zero typed by accident, which H1 would otherwise lock in forever;
 * - one order's items (price × quantity, summed) are at most 20 million baht, checked at
 *   checkout. Checking there rather than only when the shop quotes shipping means an order that
 *   could never be given a total is never created, instead of sitting until clock 1 cancels it.
 */
export const MAX_SHIPPING_AMOUNT_MINOR = 10_000_000;
export const MAX_ORDER_ITEMS_SUBTOTAL_MINOR = 2_000_000_000;
