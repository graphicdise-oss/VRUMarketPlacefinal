import type { Prisma } from '@prisma/client';
import { CommunityScope, inCommunities } from '../community/community-admin-scope.js';

/**
 * §127: the product review queue's condition, defined once — `ProductService` lists it and the
 * admin dashboard counts it. §79: a product deleted while pending is not waiting on anyone.
 */
export function pendingProductsWhere(filter: CommunityScope): Prisma.ProductWhereInput {
  return { moderationStatus: 'PENDING', deletedAt: null, shop: inCommunities(filter) };
}
