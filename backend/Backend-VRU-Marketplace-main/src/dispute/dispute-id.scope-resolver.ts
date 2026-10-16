import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isUuid } from '../common/id.js';
import { ShopScopeResolver } from '../community/shop-scope-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * #64: `Dispute.shopId` is denormalized directly onto the row (see that column's own schema
 * comment, from #63) — the same one-hop shape `ReviewIdScopeResolver` uses.
 */
@Injectable()
export class DisputeIdScopeResolver implements ShopScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCommunityId(request: Request): Promise<string | null> {
    const disputeId = request.params.disputeId;

    if (typeof disputeId !== 'string' || !isUuid(disputeId)) {
      return null;
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: { shop: { select: { communityId: true } } },
    });

    return dispute?.shop.communityId ?? null;
  }
}
