import { Prisma } from '@prisma/client';

/**
 * One deadline an order's sweep enforces, written once: the window's start column and the
 * condition under which that window is running. The sweep tasks build their expiry and warning
 * conditions from it, and `OrderClocksOutagePause` pauses every clock listed in `ORDER_CLOCKS` from
 * it — so a clock's "running" rule cannot be edited in one place and left stale in the other.
 *
 * §122 review: before this, the pause held a hand-written SQL copy of each task's condition, and a
 * new deadline or a changed condition had to be remembered in both. Nothing failed when it was
 * not: the clock would simply eat the next outage, which is the failure §116 exists to prevent.
 */
export interface OrderClock {
  /** For logs and tests. */
  readonly name: string;
  /** The `Order` field holding when the window started. */
  readonly startedAtField: OrderClockStartField;
  /**
   * The same column's database name — the one thing the pause cannot do through Prisma is add an
   * interval to a column, so it writes this one raw. A constant, never input.
   */
  readonly startedAtColumn: string;
  /** Running, apart from the time itself: the status the clock belongs to, not frozen (H3), and whatever else stops it. */
  readonly running: Prisma.OrderWhereInput;
}

type OrderClockStartField =
  | 'shippingQuoteWindowStartedAt'
  | 'paymentWindowStartedAt'
  | 'paymentConfirmationWindowStartedAt'
  | 'refundSlipWindowStartedAt'
  | 'refundConfirmWindowStartedAt';

/** Bounds on when a window started. */
export interface StartedWithin {
  readonly lte?: Date;
  readonly gt?: Date;
}

/** The clock's running condition with its window started within `range` — what every task and the pause query by. */
export function clockWhere(clock: OrderClock, range: StartedWithin): Prisma.OrderWhereInput {
  // A computed key widens to an index signature; `startedAtField` is a union of real `Order` date
  // fields, so the object is a valid filter.
  const started = { [clock.startedAtField]: range } as Prisma.OrderWhereInput;

  return { ...clock.running, ...started };
}

/** Clock 1 (invariant 3): the shop quotes shipping within 24h of checkout. */
export const SHIPPING_QUOTE_CLOCK: OrderClock = {
  name: 'shippingQuote',
  startedAtField: 'shippingQuoteWindowStartedAt',
  startedAtColumn: 'shipping_quote_window_started_at',
  running: { status: 'AWAITING_SHIPPING_QUOTE', frozenAt: null },
};

/** Clock 2: the buyer pays and uploads a slip within 24h of the quote. */
export const PAYMENT_CLOCK: OrderClock = {
  name: 'payment',
  startedAtField: 'paymentWindowStartedAt',
  startedAtColumn: 'payment_window_started_at',
  running: { status: 'AWAITING_PAYMENT', frozenAt: null },
};

/** Clock 3: the shop confirms the money arrived within 3 days of the round's first slip. */
export const PAYMENT_CONFIRMATION_CLOCK: OrderClock = {
  name: 'paymentConfirmation',
  startedAtField: 'paymentConfirmationWindowStartedAt',
  startedAtColumn: 'payment_confirmation_window_started_at',
  running: { status: 'PAYMENT_SUBMITTED', frozenAt: null },
};

/**
 * K11: the shop sends a refund slip within 7 days of the buyer's account (§118). Stops once a slip
 * is up, once the penalty has landed, or once a ruling waived it.
 */
export const REFUND_SLIP_CLOCK: OrderClock = {
  name: 'refundSlip',
  startedAtField: 'refundSlipWindowStartedAt',
  startedAtColumn: 'refund_slip_window_started_at',
  running: {
    status: 'REFUND_ORDERED',
    frozenAt: null,
    refundOverdueFlaggedAt: null,
    refundSlipFirstUploadedAt: null,
    refundPenaltyWaivedAt: null,
  },
};

/**
 * H7: the buyer objects within 7 days of the first refund slip, or the refund counts as received.
 * Still running while a dispute waits for a ruling — the sweep holds off closing it then
 * (`RefundBuyerConfirmExpirySweepTask`), but the window itself has not stopped.
 */
export const REFUND_BUYER_CONFIRM_CLOCK: OrderClock = {
  name: 'refundBuyerConfirm',
  startedAtField: 'refundConfirmWindowStartedAt',
  startedAtColumn: 'refund_confirm_window_started_at',
  running: { status: 'REFUND_ORDERED', frozenAt: null },
};

/**
 * Every deadline the sweep enforces on an order. ⚠️ A new one goes here, or an outage eats it
 * (§116). D5b's dispute window is not here: no sweep enforces it — the dispute door does — and it
 * is paused through its own column (`disputeWindowPausedSeconds`).
 */
export const ORDER_CLOCKS: readonly OrderClock[] = [
  SHIPPING_QUOTE_CLOCK,
  PAYMENT_CLOCK,
  PAYMENT_CONFIRMATION_CLOCK,
  REFUND_SLIP_CLOCK,
  REFUND_BUYER_CONFIRM_CLOCK,
];
