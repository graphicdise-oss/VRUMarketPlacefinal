import type { Prisma } from '@prisma/client';

export type CouponClaimRestoreClient = {
  userCouponClaim: {
    findFirst(args: Prisma.UserCouponClaimFindFirstArgs): Promise<{ id: string; couponId: string } | null>;
    update(args: Prisma.UserCouponClaimUpdateArgs): Promise<unknown>;
  };
  shopCoupon: {
    update(args: Prisma.ShopCouponUpdateArgs): Promise<unknown>;
  };
};

/**
 * Restores a claimed coupon when an order is cancelled (buyer/seller cancel, timeout sweep,
 * admin freeze termination, or product prohibited).
 * Clears isUsed, usedAt, orderId on UserCouponClaim and decrements usedCount on ShopCoupon.
 */
export async function restoreOrderCouponClaim(
  client: CouponClaimRestoreClient,
  orderId: string,
): Promise<void> {
  const claim = await client.userCouponClaim.findFirst({
    where: { orderId, isUsed: true },
  });
  if (claim) {
    await client.userCouponClaim.update({
      where: { id: claim.id },
      data: { isUsed: false, usedAt: null, orderId: null },
    });
    try {
      await client.shopCoupon.update({
        where: { id: claim.couponId },
        data: { usedCount: { decrement: 1 } },
      });
    } catch {
      // Ignore if coupon already removed or modified
    }
  }
}

