import type { Prisma } from '@prisma/client';

/**
 * #42: invariant 6's first two visibility layers — the product's own. Combined with
 * `LIVE_SHOP_FILTER` (the third layer, on the owning shop) this is the single point every place
 * that lists products spreads into its own query, exactly the way `shop-visibility.ts`'s own
 * comment asked topic 5 to do rather than re-deriving "and the shop isn't suspended" a second
 * time.
 *
 * Deliberately **not** used for the single-product direct-link view: `ProductService.findPublic`
 * keeps its own, narrower rule (this filter, but never `LIVE_SHOP_FILTER`) so a product whose
 * shop is closed or suspended keeps answering instead of 404ing — see that method's own comment,
 * mirroring `ShopService.findPublic`'s identical split for the same reason (I14).
 */
export const PRODUCT_OWN_VISIBILITY_FILTER: Prisma.ProductWhereInput = {
  deletedAt: null,
  moderationStatus: 'APPROVED',
  shopPublishStatus: 'PUBLISHED',
};
