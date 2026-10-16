import { Injectable } from '@nestjs/common';
import { UserRole, OrderStatus } from '@prisma/client';
import { communityFilterFor, inCommunities } from '../community/community-admin-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminDashboardDto } from './dto/admin-dashboard.dto.js';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(actorUserId: string, role: UserRole, communityIdFilter?: string, timeFilter: string = 'WEEK'): Promise<AdminDashboardDto> {
    const filter = await communityFilterFor(this.prisma, actorUserId, role);
    if (filter === 'none') {
      return this.emptyDashboard();
    }

    let communitiesToQuery = filter;
    if (communityIdFilter) {
      if (filter !== 'all' && !filter.includes(communityIdFilter)) {
        return this.emptyDashboard(); // Not authorized for this specific community
      }
      communitiesToQuery = [communityIdFilter];
    }

    const whereScope = inCommunities(communitiesToQuery);
    if (!whereScope) {
      return this.emptyDashboard();
    }

    // 1. Queues
    const pendingShopApprovals = await this.prisma.shop.count({
      where: { approvalStatus: 'PENDING', closedAt: null, ...whereScope },
    });
    const pendingShopEdits = await this.prisma.shop.count({
      where: { profileChangeRequestedAt: { not: null }, closedAt: null, ...whereScope },
    });
    const pendingProductChecks = await this.prisma.product.count({
      where: { moderationStatus: 'PENDING', deletedAt: null, shop: { closedAt: null, ...whereScope } },
    });
    const openDisputes = await this.prisma.dispute.count({
      where: { ruledAt: null, order: { shop: { ...whereScope } } },
    });
    const frozenOrders = await this.prisma.order.count({
      where: { frozenAt: { not: null }, shop: { ...whereScope } },
    });

    // 2. Overview
    const activeShops = await this.prisma.shop.count({
      where: { approvalStatus: 'APPROVED', closedAt: null, suspendedAt: null, ...whereScope },
    });
    const suspendedShops = await this.prisma.shop.count({
      where: { suspendedAt: { not: null }, closedAt: null, ...whereScope },
    });
    const bannedOwners = await this.prisma.shop.count({
      where: { owner: { bannedAt: { not: null } }, closedAt: null, ...whereScope },
    });
    const activeProducts = await this.prisma.product.count({
      where: { moderationStatus: 'APPROVED', deletedAt: null, shopPublishStatus: 'PUBLISHED', shop: { closedAt: null, suspendedAt: null, ...whereScope } },
    });
    
    // Group orders by status
    const ordersGrouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: { shop: { ...whereScope } },
      _count: { id: true },
    });
    const ordersByStatus: Record<string, number> = {};
    for (const group of ordersGrouped) {
      ordersByStatus[group.status] = group._count.id;
    }

    // 3. Sales
    // Calculate dateFilter
    // eslint-disable-next-line no-restricted-syntax -- wall clock reference for filter bounds
    const now = new Date();
     
    let dateFilter = new Date(0);
    if (timeFilter === 'TODAY') {
       
      dateFilter = new Date(now);
      dateFilter.setHours(0, 0, 0, 0);
    } else if (timeFilter === 'WEEK') {
       
      dateFilter = new Date(now);
      dateFilter.setDate(now.getDate() - 7);
    } else if (timeFilter === 'MONTH') {
       
      dateFilter = new Date(now);
      dateFilter.setMonth(now.getMonth() - 1);
    } else if (timeFilter === '12MONTHS') {
       
      dateFilter = new Date(now);
      dateFilter.setFullYear(now.getFullYear() - 1);
    } else if (timeFilter === 'YEAR') {
       
      dateFilter = new Date(now);
      dateFilter.setMonth(0, 1);
      dateFilter.setHours(0, 0, 0, 0);
    }

    const validStatuses: OrderStatus[] = ['PAID', 'SHIPPED', 'COMPLETED'];
    const salesAggregate = await this.prisma.order.aggregate({
      where: {
        createdAt: { gte: dateFilter },
        status: { in: validStatuses },
        shop: { ...whereScope },
      },
      _sum: { totalAmountMinor: true, shippingAmountMinor: true },
    });

    const totalSalesMinor = (salesAggregate._sum?.totalAmountMinor || 0) - (salesAggregate._sum?.shippingAmountMinor || 0);
    const totalSales = totalSalesMinor / 100;

    // Trend calculation
    const allOrdersList = await this.prisma.order.findMany({
      where: { createdAt: { gte: dateFilter }, status: { in: validStatuses }, shop: { ...whereScope } },
      select: { createdAt: true, totalAmountMinor: true, shippingAmountMinor: true },
      orderBy: { createdAt: 'asc' }
    });

    const trendMap = new Map<string, number>();
    
    allOrdersList.forEach((o) => {
      let key: string;
      if (timeFilter === 'TODAY') {
        key = o.createdAt.getHours().toString().padStart(2, '0') + ':00';
      } else if (timeFilter === 'WEEK' || timeFilter === 'MONTH') {
        key = o.createdAt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
      } else {
        key = o.createdAt.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
      }
      
      const sales = ((o.totalAmountMinor || 0) - (o.shippingAmountMinor || 0)) / 100;
      trendMap.set(key, (trendMap.get(key) || 0) + sales);
    });

    const trend = Array.from(trendMap.entries()).map(([name, sales]) => ({
      name,
      sales,
    }));

    // Fill empty trend if needed
    if (trend.length === 0) {
      trend.push({ name: 'ไม่มีข้อมูล', sales: 0 });
    }

    return {
      queues: {
        pendingShopApprovals,
        pendingShopEdits,
        pendingProductChecks,
        openDisputes,
        frozenOrders,
      },
      overview: {
        activeShops,
        suspendedShops,
        bannedOwners,
        activeProducts,
        ordersByStatus,
      },
      sales: {
        totalSales,
        trend,
      }
    };
  }

  private emptyDashboard(): AdminDashboardDto {
    return {
      queues: {
        pendingShopApprovals: 0,
        pendingShopEdits: 0,
        pendingProductChecks: 0,
        openDisputes: 0,
        frozenOrders: 0,
      },
      overview: {
        activeShops: 0,
        suspendedShops: 0,
        bannedOwners: 0,
        activeProducts: 0,
        ordersByStatus: {},
      },
      sales: {
        totalSales: 0,
        trend: [],
      }
    };
  }
}
