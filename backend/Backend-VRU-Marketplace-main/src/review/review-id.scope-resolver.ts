import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isUuid } from '../common/id.js';
import { ShopScopeResolver } from '../community/shop-scope-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * #60 (L3): a review has no `communityId` of its own, the same reasoning `ProductIdScopeResolver`
 * already gives — but unlike a product, it doesn't even need the two-hop join that resolver does:
 * `Review.shopId` is denormalized directly onto the row (see that model's own schema comment), so
 * this is a single `findUnique` down to `Shop.communityId`, one hop shorter than a product's.
 */
@Injectable()
export class ReviewIdScopeResolver implements ShopScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCommunityId(request: Request): Promise<string | null> {
    const reviewId = request.params.reviewId;

    if (typeof reviewId !== 'string' || !isUuid(reviewId)) {
      return null;
    }

    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { shop: { select: { communityId: true } } },
    });

    return review?.shop.communityId ?? null;
  }
}
