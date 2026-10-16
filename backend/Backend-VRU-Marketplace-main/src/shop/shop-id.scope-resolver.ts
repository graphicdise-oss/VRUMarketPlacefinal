import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isUuid } from '../common/id.js';
import { ShopScopeResolver } from '../community/shop-scope-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The first, simplest `ShopScopeResolver`: the route's target *is* the shop, named by a
 * `:shopId` path param. Later topics write their own — a product route resolves through
 * `Product.shopId`, an order route through `Order.shopId` — but every one of them ends the same
 * way this one starts: a single `findUnique` down to `Shop.communityId`.
 */
@Injectable()
export class ShopIdScopeResolver implements ShopScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCommunityId(request: Request): Promise<string | null> {
    const shopId = request.params.shopId;

    // Guards run before the validation pipe, so this has not been through ParseUUIDPipe yet —
    // only Express's own routing guarantees it exists at all, and Postgres's uuid column would
    // reject a malformed value with its own error rather than a clean "no row". Checking the
    // shape here keeps that a plain "not found": the pipe still gets its turn to answer with a
    // proper 400, for any caller this guard lets through far enough to reach the handler.
    if (typeof shopId !== 'string' || !isUuid(shopId)) {
      return null;
    }

    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { communityId: true },
    });

    return shop?.communityId ?? null;
  }
}
