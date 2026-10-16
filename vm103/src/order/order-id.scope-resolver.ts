import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isUuid } from '../common/id.js';
import { ShopScopeResolver } from '../community/shop-scope-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * #62: an order already carries `shopId` directly (invariant 4 — one order, one shop), so this
 * is a single `findUnique` down to `Shop.communityId`, the same one-hop shape
 * `ReviewIdScopeResolver` uses and one hop shorter than `ProductIdScopeResolver`'s.
 */
@Injectable()
export class OrderIdScopeResolver implements ShopScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCommunityId(request: Request): Promise<string | null> {
    const orderId = request.params.orderId;

    if (typeof orderId !== 'string' || !isUuid(orderId)) {
      return null;
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shop: { select: { communityId: true } } },
    });

    return order?.shop.communityId ?? null;
  }
}
