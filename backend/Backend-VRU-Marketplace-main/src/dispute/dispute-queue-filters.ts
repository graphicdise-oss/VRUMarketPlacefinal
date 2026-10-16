import type { Prisma } from '@prisma/client';
import { CommunityScope, inCommunities } from '../community/community-admin-scope.js';

/**
 * §127: the open-dispute queue's condition, defined once — `DisputeService.queue` lists it and the
 * admin dashboard counts it. Leaves out the caller's own cases (N28): they cannot rule on them, so
 * they are somebody else's work.
 */
export function openDisputesWhere(actorUserId: string, filter: CommunityScope): Prisma.DisputeWhereInput {
  return {
    closedAt: null,
    order: { buyerId: { not: actorUserId } },
    shop: { ownerId: { not: actorUserId }, ...inCommunities(filter) },
  };
}

/**
 * A dispute that still decides its order (J3): open, and not ruled yet. A `BUYER_WINS` dispute stays open until its refund loop closes it (§102),
 * so "open" alone overstates what still needs a ruling.
 */
export const UNRULED_OPEN_DISPUTE = { closedAt: null, verdict: null } satisfies Prisma.DisputeWhereInput;

/**
 * §127: a dispute the shop can still answer — open, not answered, not ruled (§102 refuses an answer
 * after the ruling). The condition `DisputeService.respond` claims its write with, and the shop
 * dashboard counts.
 */
export const AWAITING_SHOP_RESPONSE = { closedAt: null, respondedAt: null, verdict: null } satisfies Prisma.DisputeWhereInput;
