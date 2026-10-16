import type { Request } from 'express';

/**
 * "A way to find the target's shop" — the parameter #32's acceptance criteria requires the
 * two-tier guard to take, instead of the guard being written against one target type.
 *
 * Every future admin action (a product, an order, a dispute, a frozen order ruling, a review)
 * traces back to exactly one `Shop` (A6), but none of those routes carry a `communityId` in
 * their URL — a product route has a `productId`, not a `communityId`, and A6 forbids storing one
 * on `Product` just so a guard could read it directly. So the guard is handed a strategy for
 * finding *that* shop, not a shop id: implement one of these per target type, and register it as
 * a provider so `CommunityScopeGuard` can look it up by class through `@RequiresCommunityAdmin()`.
 */
export interface ShopScopeResolver {
  /**
   * The `communityId` of the shop this request's target belongs to, or `null` if the target does
   * not exist.
   *
   * `null` is deliberately not distinguished from "exists but in a community the caller does not
   * administer" by the guard that calls this — see `CommunityScopeGuard` for why: telling the two
   * apart would let a caller with no rights at all enumerate which ids are real.
   */
  resolveCommunityId(request: Request): Promise<string | null>;
}
