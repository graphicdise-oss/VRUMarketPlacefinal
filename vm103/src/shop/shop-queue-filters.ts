import type { Prisma } from '@prisma/client';
import { CommunityScope, inCommunities } from '../community/community-admin-scope.js';

/**
 * §127: the two shop review queues' conditions, defined once — `ShopService` lists them and the
 * admin dashboard counts them, so the number on the dashboard is always the length of the list the
 * admin opens next. `filter` is a `communityFilterFor` result already past its `'none'` check.
 */
export function pendingShopsWhere(filter: CommunityScope): Prisma.ShopWhereInput {
  return { approvalStatus: 'PENDING', ...inCommunities(filter) };
}

/** §86: a requested name/description/logo change, on a shop that is still open. */
export function pendingProfileChangesWhere(filter: CommunityScope): Prisma.ShopWhereInput {
  return { profileChangeRequestedAt: { not: null }, closedAt: null, ...inCommunities(filter) };
}
