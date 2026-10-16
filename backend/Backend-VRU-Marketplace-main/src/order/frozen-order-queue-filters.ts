import type { Prisma } from '@prisma/client';
import { CommunityScope, inCommunities } from '../community/community-admin-scope.js';

/**
 * §127: the frozen-order queue's condition, defined once — `FrozenOrderService.queue` lists it and
 * the admin dashboard counts it. Leaves out the caller's own cases (N28).
 */
export function frozenOrdersWhere(actorUserId: string, filter: CommunityScope): Prisma.OrderWhereInput {
  return {
    frozenAt: { not: null },
    buyerId: { not: actorUserId },
    shop: { ownerId: { not: actorUserId }, ...inCommunities(filter) },
  };
}
