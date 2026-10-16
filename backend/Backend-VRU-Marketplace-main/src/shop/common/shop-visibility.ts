import type { Prisma } from '@prisma/client';

/**
 * The one place all layers of "is this shop's storefront live" combine.
 *
 * So far: approved (#35) + not closed (#37) + not suspended (#38). Invariant 6 calls the shop's
 * own status the *third* layer of product visibility, on top of `Product.shopPublishStatus` and
 * `Product.moderationStatus` (topic 5) — this is explicitly the one point #38's own acceptance
 * criteria requires those two layers to combine with, rather than topic 5 writing its own copy
 * of "and the shop isn't suspended" beside this one. Topic 5's product query spreads this into
 * its own shop-relation filter; it does not re-derive the condition.
 *
 * This governs the **list and search** — whether a shop (or, later, a product) shows up when
 * nobody went looking for it by id. It is deliberately not used for the single-shop direct-link
 * view: `ShopService.findPublic` keeps its own, looser rule (approved is enough) precisely so a
 * closed or suspended shop's direct link keeps answering instead of 404ing — see that method's
 * comment for the full reasoning invariant 6 and #37 both give for that split.
 *
 * §92 (owner's decision): and the owner is not banned. A banned seller's shop stops selling the way
 * a suspended one does — out of the lists and search, no new orders — read off the owner's live
 * flag rather than copied onto the shop, so lifting the ban brings the shop back with nothing to
 * undo. Every caller (lists, search, the cart's `orderable`, checkout's re-check under its locks)
 * picks this up from here.
 */
export const LIVE_SHOP_FILTER: Prisma.ShopWhereInput = {
  approvalStatus: 'APPROVED',
  closedAt: null,
  suspendedAt: null,
  owner: { bannedAt: null },
};

/**
 * §92: what a stranger's direct link reports as the shop's suspension. A banned owner shows the
 * same "ร้านนี้ถูกระงับชั่วคราว" badge a suspension does (owner's decision) — the public view never
 * says that a person's *account* was banned. Admin views keep reading the two columns apart.
 */
export function publicSuspendedAt(shop: { suspendedAt: Date | null; owner: { bannedAt: Date | null } }): Date | null {
  return shop.suspendedAt ?? shop.owner.bannedAt;
}
