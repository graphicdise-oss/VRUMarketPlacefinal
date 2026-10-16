import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isUuid } from '../common/id.js';
import { ShopScopeResolver } from '../community/shop-scope-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * #43: a product has no `communityId` of its own (A6) — it is reachable through
 * `Product.shopId → Shop.communityId`, exactly the two-hop resolution `ShopIdScopeResolver`'s own
 * comment predicted a later topic would need. The route names the product by `:productId`, not
 * `:shopId`, so this cannot reuse that resolver directly even though the second half of the query
 * is identical.
 */
@Injectable()
export class ProductIdScopeResolver implements ShopScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCommunityId(request: Request): Promise<string | null> {
    const productId = request.params.productId;

    // Same reasoning as ShopIdScopeResolver: guards run before the validation pipe, so this has
    // not been through ParseUUIDPipe yet.
    if (typeof productId !== 'string' || !isUuid(productId)) {
      return null;
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { shop: { select: { communityId: true } } },
    });

    return product?.shop.communityId ?? null;
  }
}
