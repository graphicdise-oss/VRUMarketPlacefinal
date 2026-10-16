import { Prisma } from '@prisma/client';

/**
 * I8: the one way an order reaches `REFUNDED` — shared by the buyer's own confirmation (H6,
 * `RefundService.confirmReceived`) and the 7-day cron that assumes it (H7,
 * `RefundBuyerConfirmExpirySweepTask`), which each used to carry their own copy (§85).
 *
 * Conditional on `where` (the caller's own "still eligible" test, e.g. still `REFUND_ORDERED` and
 * not frozen), so a transition that lost its race to another writer changes nothing and answers
 * `false`. Wipes the buyer's receiving account (L9 — no longer needed) and closes any dispute
 * still open on the order in the same transaction — the thing that actually revokes a community
 * admin's break-glass access (see `Dispute.closedAt`'s own schema comment).
 */
export async function markRefunded(tx: Prisma.TransactionClient, orderId: string, where: Prisma.OrderWhereInput, now: Date): Promise<boolean> {
  const gated = await tx.order.updateMany({
    where: { ...where, id: orderId },
    data: {
      status: 'REFUNDED',
      refundAccountType: null,
      refundBankName: null,
      refundBankAccountNumber: null,
      refundBankAccountName: null,
      refundPromptPayId: null,
      updatedAt: now,
    },
  });
  if (gated.count === 0) {
    return false;
  }

  await tx.dispute.updateMany({ where: { orderId, closedAt: null }, data: { closedAt: now, updatedAt: now } });

  return true;
}
