import type { Prisma } from '@prisma/client';

/**
 * §127: what a shop's open orders are waiting on, defined once for the shop dashboard. Each entry is
 * a condition on one order, read together with `ownedByShopOwner` — the same scope as
 * `GET /shops/me/orders`, so every number is the length of a list the shop can open. That list
 * filters by status alone, so the plain-status entries here are its `?status=` filter word for word;
 * `test/dashboard.spec.ts` holds the two side by side.
 *
 * Frozen orders are counted where their status puts them, not left out: a shop keeps setting the
 * fee, confirming, shipping and refunding while an order is frozen (J2 — "ระงับ = ห้ามขายใหม่ ไม่ใช่
 * ห้ามทำของค้าง"), so a frozen order still waiting on the shop is still the shop's work.
 *
 * The three `REFUND_ORDERED` steps follow `RefundService`'s own gates: the shop can upload once the
 * buyer has given an account (`refundAccountType`), and the buyer can confirm once the shop has
 * uploaded in this loop (`refundSlipFirstUploadedAt` — not the slip rows, which stay as evidence
 * after a dispute restarts the loop).
 */
export const SHOP_TODO = {
  awaitingShippingQuote: { status: 'AWAITING_SHIPPING_QUOTE' },
  awaitingPaymentConfirmation: { status: 'PAYMENT_SUBMITTED' },
  awaitingShipment: { status: 'PAID' },
  awaitingRefundSlip: { status: 'REFUND_ORDERED', refundAccountType: { not: null }, refundSlipFirstUploadedAt: null },
} as const satisfies Record<string, Prisma.OrderWhereInput>;

/** The orders a shop has done its part on and is waiting for the buyer (or an admin) to move. */
export const SHOP_WAITING = {
  awaitingBuyerPayment: { status: 'AWAITING_PAYMENT' },
  shippedAwaitingReceipt: { status: 'SHIPPED' },
  awaitingRefundAccount: { status: 'REFUND_ORDERED', refundAccountType: null },
  awaitingRefundReceipt: { status: 'REFUND_ORDERED', refundSlipFirstUploadedAt: { not: null } },
  frozen: { frozenAt: { not: null } },
} as const satisfies Record<string, Prisma.OrderWhereInput>;
