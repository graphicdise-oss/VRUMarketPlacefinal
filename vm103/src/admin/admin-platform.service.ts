
import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service.js';
import { NotificationService } from '../notification/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { BroadcastAudience, BroadcastNotificationDto, PlatformDashboardDto } from './dto/admin-platform.dto.js';

@Injectable()
export class AdminPlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
  ) {}


  async getDashboardStats(
    timeFilter: string,
    _locationType: string,
    _selectedLocation: string,
  ): Promise<PlatformDashboardDto> {
    const now = this.clock.now();
     
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
    } else if (timeFilter === 'YEAR') {
       
      dateFilter = new Date(now);
      dateFilter.setFullYear(now.getFullYear() - 1);
    }

    // 1. Basic counts
    const totalUsers = await this.prisma.user.count({ where: { createdAt: { gte: dateFilter } } });
    const totalCommunities = await this.prisma.community.count({ where: { createdAt: { gte: dateFilter } } });
    const totalAdmins = await this.prisma.communityAdmin.count({ where: { assignedAt: { gte: dateFilter } } });
    const totalAppeals = await this.prisma.dispute.count({ where: { createdAt: { gte: dateFilter } } });

    const bannedUsers = await this.prisma.user.count({ where: { bannedAt: { not: null } } });
    const pendingAppeals = await this.prisma.dispute.count({ where: { ruledAt: null } });
    const pendingShops = await this.prisma.shop.count({ where: { approvalStatus: 'PENDING' } });

    // 2. Orders & Sales
    const validStatuses: OrderStatus[] = ['PAID', 'SHIPPED', 'COMPLETED'];
    const totalOrders = await this.prisma.order.count({
      where: { createdAt: { gte: dateFilter }, status: { in: validStatuses } }
    });
    
    const orderSum = await this.prisma.order.aggregate({
      _sum: {
        totalAmountMinor: true,
        shippingAmountMinor: true,
      },
      where: { createdAt: { gte: dateFilter }, status: { in: validStatuses } }
    });
    
    const totalSales = ((orderSum._sum?.totalAmountMinor || 0) - (orderSum._sum?.shippingAmountMinor || 0)) / 100;

    // 3. Sales By Community (Location fallback)
    const communitiesList = await this.prisma.community.findMany({
      select: {
        id: true,
        name: true,
        shops: {
          select: {
            orders: {
              where: { createdAt: { gte: dateFilter }, status: { in: validStatuses } },
              select: {
                totalAmountMinor: true,
                shippingAmountMinor: true,
              },
            },
            disputes: {
              where: { createdAt: { gte: dateFilter } },
              select: { id: true }
            }
          },
        },
      },
    });

    const salesByLocation = communitiesList.map((c) => {
      let sales = 0;
      let orders = 0;
      let issues = 0;
      c.shops.forEach((shop) => {
        orders += shop.orders.length;
        issues += shop.disputes?.length || 0;
        shop.orders.forEach((order) => {
          sales += ((order.totalAmountMinor || 0) - (order.shippingAmountMinor || 0)) / 100;
        });
      });
      return {
        name: c.name,
        sales,
        orders,
        communities: 1,
        issues,
      };
    }).sort((a, b) => b.sales - a.sales).slice(0, 10);

    // 4. Platform Trend (Orders by Month)
    const allOrdersList = await this.prisma.order.findMany({
      where: { createdAt: { gte: dateFilter }, status: { in: validStatuses } },
      select: { createdAt: true },
    });
    
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const trendMap = new Map<number, number>();
    allOrdersList.forEach((o) => {
      const m = o.createdAt.getMonth();
      trendMap.set(m, (trendMap.get(m) || 0) + 1);
    });
    
    const platformTrend = Array.from(trendMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([m, count]) => ({
        name: months[m] as string,
        orders: count,
      }));

    if (platformTrend.length === 0) {
      const currentMonth = now.getMonth();
      platformTrend.push({ name: months[currentMonth] as string, orders: 0 });
    }

    return {
      totalUsers,
      totalCommunities,
      totalAdmins,
      totalAppeals,
      totalSales,
      totalOrders,
      bannedUsers,
      pendingAppeals,
      pendingShops,
      salesByLocation,
      platformTrend,
      issueStatus: [
        { name: 'รอพิจารณาอุทธรณ์', value: pendingAppeals },
        { name: 'ตัดสินแล้ว', value: totalAppeals - pendingAppeals },
      ],
    };
  }

  async sendBroadcast(adminId: string, dto: BroadcastNotificationDto): Promise<void> {
    const { audience, message } = dto;

    let targetUsers: { id: string }[] = [];

    switch (audience) {
      case BroadcastAudience.ALL:
        targetUsers = await this.prisma.user.findMany({ select: { id: true } });
        break;
      case BroadcastAudience.SELLERS:
        targetUsers = await this.prisma.user.findMany({
          where: { shops: { some: {} } },
          select: { id: true },
        });
        break;
      case BroadcastAudience.COMMUNITY_ADMINS:
        targetUsers = await this.prisma.user.findMany({
          where: { communityAdmins: { some: {} } },
          select: { id: true },
        });
        break;
    }

    if (targetUsers.length > 0) {
      await Promise.all(
        targetUsers.map((user) =>
          this.notifications.notify({
            userId: user.id,
            type: 'PLATFORM_ANNOUNCEMENT',
            message,
          }),
        ),
      );
    }

    await this.audit.record({
      action: 'BROADCAST_NOTIFICATION_SENT',
      actorUserId: adminId,
      targetType: 'SYSTEM',
      targetId: null,
      reason: `Audience: ${audience}. Message: ${message}`,
    });
  }
}
