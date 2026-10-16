import { OrderStatus } from '@prisma/client';
import { addDays, addSeconds } from '../../time/clock.js';
import { DISPUTE_WINDOW_AFTER_CANCELLED_DAYS, DISPUTE_WINDOW_AFTER_RECEIVED_DAYS, DISPUTE_WINDOW_AFTER_SHIPPED_DAYS } from './dispute-policy.js';

/** The columns D5b's deadline needs — a subset of `Order`, so `OrderDto` can reuse this too. */
export interface DisputeWindowOrder {
  status: OrderStatus;
  shippedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  frozenDurationSeconds: number;
  disputeWindowPausedSeconds?: number;
}

/**
 * D5b: the deadline to open a dispute — the **earlier** of 15 days from `shippedAt` (I15) and 7
 * days from `completedAt` (D5), whichever comes first once both exist; for a cancelled order, 15
 * days from `cancelledAt` (§85). `null` means "no deadline yet" (a live order that hasn't shipped,
 * so no clock has started) — never "no deadline ever".
 *
 * The 15-day leg is shifted out by `frozenDurationSeconds` (N3): time this order spent frozen for
 * an unrelated reason must not eat into the buyer's own window to dispute something, the same
 * reasoning H3 gives clocks 1–3, applied to a fixed deadline instead of a resettable one — see
 * that column's own schema comment. The 7-day leg needs no such adjustment: `completedAt` can
 * only ever be set while the order is *not* frozen (`markReceived` refuses outright while frozen,
 * N3), so nothing frozen ever happens after it.
 *
 * §116 (owner's decision): every leg is then shifted out by `disputeWindowPausedSeconds` — the
 * platform outages the window was open through (`OrderClocksOutagePause`).
 */
export function disputeDeadline(order: DisputeWindowOrder): Date | null {
  const deadline = unpausedDisputeDeadline(order);

  // §116: a platform outage the window was open through moves whichever leg applies.
  return deadline === null ? null : addSeconds(deadline, order.disputeWindowPausedSeconds ?? 0);
}

function unpausedDisputeDeadline(order: DisputeWindowOrder): Date | null {
  // §85: a cancelled order (it never shipped — nothing cancels an order past PAID) gets its own
  // 15 days from the cancellation. Before, an order that never shipped had no deadline ever.
  if (order.status === 'CANCELLED' && order.cancelledAt !== null) {
    return addDays(order.cancelledAt, DISPUTE_WINDOW_AFTER_CANCELLED_DAYS);
  }
  if (order.shippedAt === null) {
    return null;
  }

  const shippedDeadline = shippedLegDeadline(order.shippedAt, order.frozenDurationSeconds);
  if (order.completedAt === null) {
    return shippedDeadline;
  }

  const completedDeadline = addDays(order.completedAt, DISPUTE_WINDOW_AFTER_RECEIVED_DAYS);

  return shippedDeadline.getTime() < completedDeadline.getTime() ? shippedDeadline : completedDeadline;
}

/**
 * D5b's 15 days from `shippedAt`, shifted out by the frozen time that fell inside them. The one
 * formula — H10's erasure clearance (`AccountErasureService`) reuses it rather than keeping a copy.
 */
export function shippedLegDeadline(shippedAt: Date, frozenDurationSeconds: number): Date {
  return addSeconds(addDays(shippedAt, DISPUTE_WINDOW_AFTER_SHIPPED_DAYS), frozenDurationSeconds);
}

/**
 * §116: how much of one freeze episode, ending `now`, counts toward `frozenDurationSeconds` — only
 * the part after `shippedAt`, since that is the only part the 15-day window could have lost.
 * Before, every episode counted in full: twenty days frozen while waiting for payment gave the
 * buyer thirty-five days to dispute a parcel that shipped later — the same over-credit §85 removed
 * from K11/H7. An episode the shipment landed in the middle of (a frozen order may still ship, J2)
 * counts from the shipment on.
 */
export function frozenSecondsAfterShipment(frozenAt: Date, shippedAt: Date | null, now: Date): number {
  if (shippedAt === null) {
    return 0;
  }
  const countedFrom = Math.max(frozenAt.getTime(), shippedAt.getTime());

  return Math.max(0, Math.round((now.getTime() - countedFrom) / 1000));
}

/**
 * Whether a dispute may be opened right this instant. Currently-frozen orders are always
 * eligible — N3's "frozen time doesn't count" taken to its logical end: since we don't yet know
 * how long *this* freeze episode will last, the only way to never shortchange the buyer is to not
 * enforce the deadline at all while it's ongoing (`frozenDurationSeconds` only accounts for
 * episodes that have already ended).
 */
export function canOpenDisputeNow(order: DisputeWindowOrder & { frozenAt: Date | null }, now: Date): boolean {
  // §85: a refund that already completed is not reopened by a new dispute — the buyer confirmed
  // it (H6) or let H7's 7-day objection window pass, and a BUYER_WINS here used to drag the order
  // back to REFUND_ORDERED only for the sweep to close it again at once.
  if (order.status === 'REFUNDED') {
    return false;
  }
  if (order.frozenAt !== null) {
    return true;
  }

  const deadline = disputeDeadline(order);

  return deadline === null || now.getTime() <= deadline.getTime();
}
