import { OrderStatus } from '@prisma/client';

/**
 * The status groupings more than one module asks about, each written once (§85 — before it,
 * `RESERVING_STATUSES` had two copies and `STOCK_CUT_STATUSES` two copies with *different*
 * contents, each comment claiming to match the other).
 */

/** H2: every order that hasn't reached a terminal status yet — what a freeze reaches into. */
export const NON_TERMINAL_STATUSES: readonly OrderStatus[] = [
  'AWAITING_SHIPPING_QUOTE',
  'AWAITING_PAYMENT',
  'PAYMENT_SUBMITTED',
  'PAID',
  'SHIPPED',
  'REFUND_ORDERED',
];

/**
 * The order statuses invariant 3's three clocks cover — from the moment checkout creates the
 * order (clock 1: the shop must quote shipping within 24h) through the shop confirming payment
 * is in (clock 3, `PAYMENT_SUBMITTED`, up to 3 days). A reservation counts toward "sold" for
 * exactly these statuses.
 *
 * `PAID` and everything after it is excluded on purpose: #55 (topic 8) cuts real stock the
 * moment an order reaches `PAID`, so counting the reservation *and* the real cut together would
 * subtract the same units twice. `CANCELLED`/`REFUND_ORDERED`/`REFUNDED` are excluded because by
 * the time an order reaches any of them it has either never been paid for (stock was only ever
 * reserved, never cut — invariant 3's own reasoning for I1) or was cut long before, in which case
 * it already left this set at the `PAID` transition and I7 forbids restoring it automatically
 * anyway.
 */
export const RESERVING_STATUSES = ['AWAITING_SHIPPING_QUOTE', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED'] as const satisfies readonly OrderStatus[];

/**
 * H5/I4/H4's line: no slip is up, so no money can have moved and the order may simply be
 * cancelled. `PAYMENT_SUBMITTED` is deliberately *not* here — the buyer has transferred, so ending
 * that order means ordering a refund (or, for H4, freezing it), never cancelling it. An order
 * whose slip the shop rejected is back at `AWAITING_PAYMENT` and counts as unpaid again: the shop
 * has said the money did not arrive, and the buyer can still dispute that.
 */
export const UNPAID_STATUSES: readonly OrderStatus[] = ['AWAITING_SHIPPING_QUOTE', 'AWAITING_PAYMENT'];

/** #55 cuts real stock at `PAID` — so these are the statuses where I7's "adjust your stock" notice applies. */
export const STOCK_CUT_STATUSES: readonly OrderStatus[] = ['PAID', 'SHIPPED', 'COMPLETED'];

/** `RESERVING_STATUSES` as a plain `OrderStatus` list, for `.includes()` on a row's own status. */
export function isReserving(status: OrderStatus): boolean {
  return (RESERVING_STATUSES as readonly OrderStatus[]).includes(status);
}
