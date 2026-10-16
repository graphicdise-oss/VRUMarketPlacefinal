import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ShopStatsDto } from '../controllers/shop-analytics.controller.js';

@Injectable()
export class ShopAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getShopStats(ownerUserId: string): Promise<ShopStatsDto> {
    const shop = await this.prisma.shop.findFirst({
      where: { ownerId: ownerUserId, closedAt: null },
    });

    if (!shop) {
      throw new NotFoundException('Shop not found');
    }

    const shopId = shop.id;

    const [
      // Action Required
      awaitingShippingFeeCount,
      awaitingPaymentConfirmCount,
      awaitingShipmentCount,
      pendingRefundCount,
      actionableDisputeCount,
      
      // Pending Others
      awaitingBuyerPaymentCount,
      awaitingBuyerReceiveCount,
      frozenOrderCount,

      // Products
      activeProductCount,
      pendingProductCount,
      rejectedProductCount,
      hiddenProductCount,
      followerCount,
    ] = await Promise.all([
      // Action Required
      this.prisma.order.count({ where: { shopId, status: 'AWAITING_SHIPPING_QUOTE' } }),
      this.prisma.order.count({ where: { shopId, status: 'PAYMENT_SUBMITTED' } }),
      this.prisma.order.count({ where: { shopId, status: 'PAID' } }),
      this.prisma.order.count({ where: { shopId, status: 'REFUND_ORDERED' } }),
      this.prisma.dispute.count({ where: { shopId, closedAt: null } }), // open disputes

      // Pending Others
      this.prisma.order.count({ where: { shopId, status: 'AWAITING_PAYMENT' } }),
      this.prisma.order.count({ where: { shopId, status: 'SHIPPED' } }),
      this.prisma.order.count({ where: { shopId, frozenAt: { not: null } } }),

      // Products
      this.prisma.product.count({ where: { shopId, deletedAt: null, moderationStatus: 'APPROVED', shopPublishStatus: 'PUBLISHED' } }),
      this.prisma.product.count({ where: { shopId, deletedAt: null, moderationStatus: 'PENDING' } }),
      this.prisma.product.count({ where: { shopId, deletedAt: null, moderationStatus: 'REJECTED' } }),
      this.prisma.product.count({ where: { shopId, deletedAt: null, shopPublishStatus: 'UNPUBLISHED' } }),
      this.prisma.shopFollow.count({ where: { shopId } }),
    ]);

    // Sales
    const salesAggregate = await this.prisma.order.aggregate({
      where: {
        shopId,
        status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] },
      },
      _sum: { totalAmountMinor: true, shippingAmountMinor: true },
    });
    const totalSalesMinor = (salesAggregate._sum.totalAmountMinor || 0) - (salesAggregate._sum.shippingAmountMinor || 0);
    const totalSales = totalSalesMinor / 100;

    // Reviews
    const reviewAggregate = await this.prisma.review.aggregate({
      where: { shopId, deletedAt: null },
      _avg: { rating: true },
      _count: { id: true },
    });

    return {
      awaitingShippingFeeCount,
      awaitingPaymentConfirmCount,
      awaitingShipmentCount,
      pendingRefundCount,
      actionableDisputeCount,
      awaitingBuyerPaymentCount,
      awaitingBuyerReceiveCount,
      frozenOrderCount,
      activeProductCount,
      pendingProductCount,
      rejectedProductCount,
      hiddenProductCount,
      followerCount,
      totalSales,
      reviewAverage: reviewAggregate._avg.rating || 0,
      reviewCount: reviewAggregate._count.id,
    };
  }
}
