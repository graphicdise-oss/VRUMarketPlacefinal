import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';
import { AppException } from '../common/errors/app-exception.js';
import { CommunityScope, communityFilterFor, inCommunities, isAdminOfCommunity } from '../community/community-admin-scope.js';
import { UNRULED_OPEN_DISPUTE, openDisputesWhere } from '../dispute/dispute-queue-filters.js';
import { frozenOrdersWhere } from '../order/frozen-order-queue-filters.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PRODUCT_OWN_VISIBILITY_FILTER } from '../product/product-visibility.js';
import { pendingProductsWhere } from '../product/product-queue-filters.js';
import { pendingProfileChangesWhere, pendingShopsWhere } from '../shop/shop-queue-filters.js';
import { LIVE_SHOP_FILTER } from '../shop/shop-visibility.js';
import { Clock } from '../time/clock.js';
import { combineSales, confirmedSales } from './confirmed-sales.js';
import { AdminDashboardDto, AdminQueueDto, CommunityOverviewDto, DashboardFiguresDto, OrderStatusCountsDto } from './dto/admin-dashboard.dto.js';
import { CommunityRefDto, PlatformDashboardDto } from './dto/platform-dashboard.dto.js';
import { DashboardRangeDto, SalesDto, SalesTotalsDto } from './dto/sales.dto.js';
import { ThaiDateQuery, ThaiDateRange, resolveThaiDateRange } from './thai-date-range.js';

const NOT_AN_ADMIN = 'หน้านี้สำหรับแอดมินชุมชนและผู้ดูแลระบบสูงสุดเท่านั้น';
const NOT_YOUR_COMMUNITY = 'คุณไม่ได้เป็นแอดมินของชุมชนนี้';

/** Who is asking — the two fields of `CurrentUser` an admin view's scope depends on. */
type DashboardActor = { readonly id: string; readonly role: UserRole };

/** Per-community tallies, keyed by community id; a missing key is zero. */
type Tally = ReadonlyMap<string, number>;

/**
 * §127: the admin dashboards — counts only, nothing about a person, so reading one is not audited
 * (the queues it counts are not either).
 *
 * Every queue figure is computed from the same `where` its list uses (`*-queue-filters.ts`), with the
 * same `communityFilterFor` scope — the number is always the length of the list the admin opens.
 * Counts are grouped in the database (by community, or by shop and then mapped to its community),
 * never by loading rows.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async forAdmin(actor: DashboardActor, query: ThaiDateQuery & { readonly communityId?: string }): Promise<AdminDashboardDto> {
    const range = resolveThaiDateRange(this.clock.now(), query);
    const scope = await this.scopeFor(actor, query.communityId);
    const communities = await this.prisma.community.findMany({
      where: scope === 'all' ? {} : { id: { in: scope } },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const [queue, overview, sales] = await Promise.all([this.queueTallies(actor.id, scope), this.overviewTallies(scope, range), confirmedSales(this.prisma, { communities: scope }, range)]);

    // One function for a community's figures and for the total, so the total is by construction the
    // sum of the rows above it — over the communities listed, nothing else.
    const figuresOf = (communityIds: readonly string[]): DashboardFiguresDto => ({
      queue: sumOver(queue, communityIds),
      overview: { ...sumOver(overview.shops, communityIds), ordersPlacedByStatus: statusCounts(communityIds.map((id) => overview.ordersPlaced.get(id))) },
      sales: SalesDto.from(combineSales(range, communityIds.map((id) => sales.get(id)))),
    });

    return {
      range: DashboardRangeDto.from(range),
      communities: communities.map((community) => {
        const figures = figuresOf([community.id]);
        return { communityId: community.id, name: community.name, ...figures, sales: SalesTotalsDto.from(figures.sales) };
      }),
      total: figuresOf(communities.map((community) => community.id)),
    };
  }

  /** What only a super admin manages: accounts, communities, admins. `@RequiresSuperAdmin()` gates the route. */
  async forPlatform(query: ThaiDateQuery): Promise<PlatformDashboardDto> {
    const range = resolveThaiDateRange(this.clock.now(), query);
    const live = { erasedAt: null } satisfies Prisma.UserWhereInput;
    const active = { erasedAt: null, bannedAt: null } satisfies Prisma.UserWhereInput;

    const [total, emailVerified, banned, signedUpInRange, erasureQueued, communityTotal, withoutActiveAdmin, superAdmins, communityAdmins] = await Promise.all([
      this.prisma.user.count({ where: live }),
      this.prisma.user.count({ where: { ...live, emailVerifiedAt: { not: null } } }),
      this.prisma.user.count({ where: { ...live, bannedAt: { not: null } } }),
      this.prisma.user.count({ where: { ...live, createdAt: { gte: range.start, lt: range.endExclusive } } }),
      this.prisma.user.count({ where: { ...live, erasureRequestedAt: { not: null } } }),
      this.prisma.community.count(),
      // §112's rule for who hears about a queue (`communityAdminsToNotify`): a banned or erased admin
      // reaches nobody, so a community left with only those has nobody working its queue.
      this.prisma.community.findMany({
        where: { admins: { none: { user: active } } },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.user.count({ where: { ...active, role: 'SUPER_ADMIN' } }),
      this.prisma.user.count({ where: { ...active, communityAdmins: { some: {} } } }),
    ]);

    return {
      range: DashboardRangeDto.from(range),
      users: { total, emailVerified, banned, signedUpInRange, erasureQueued },
      communities: { total: communityTotal, withoutActiveAdmin: withoutActiveAdmin.map((row): CommunityRefDto => ({ communityId: row.id, name: row.name })) },
      admins: { superAdmins, communityAdmins },
    };
  }

  /**
   * The communities this dashboard covers: `communityFilterFor`'s answer, narrowed to one when asked.
   * Someone who administers nothing is refused rather than shown zeros — this is an admin page, and
   * the frontend already knows from `adminCommunityIds` whether to offer it.
   *
   * Narrowing to one community asks invariant 1's wall itself (`isAdminOfCommunity`, the check
   * `CommunityScopeGuard` uses) rather than reading the list above, so the rule lives in one place.
   */
  private async scopeFor(actor: DashboardActor, communityId: string | undefined): Promise<CommunityScope> {
    const filter = await communityFilterFor(this.prisma, actor.id, actor.role);
    if (filter === 'none') {
      throw new AppException('FORBIDDEN', { message: NOT_AN_ADMIN });
    }
    if (communityId === undefined) {
      return filter;
    }
    if (!(await isAdminOfCommunity(this.prisma, actor, communityId))) {
      throw new AppException('FORBIDDEN', { message: NOT_YOUR_COMMUNITY });
    }
    if (filter === 'all' && (await this.prisma.community.count({ where: { id: communityId } })) === 0) {
      throw new AppException('NOT_FOUND');
    }

    return [communityId];
  }

  private async queueTallies(actorUserId: string, scope: CommunityScope): Promise<Record<keyof AdminQueueDto, Tally>> {
    const [pendingShops, pendingProfileChanges, pendingProducts, openDisputes, disputesAwaitingRuling, frozenOrders] = await Promise.all([
      this.byCommunity(pendingShopsWhere(scope)),
      this.byCommunity(pendingProfileChangesWhere(scope)),
      this.prisma.product.groupBy({ by: ['shopId'], where: pendingProductsWhere(scope), _count: { _all: true } }),
      this.prisma.dispute.groupBy({ by: ['shopId'], where: openDisputesWhere(actorUserId, scope), _count: { _all: true } }),
      this.prisma.dispute.groupBy({ by: ['shopId'], where: { ...openDisputesWhere(actorUserId, scope), ...UNRULED_OPEN_DISPUTE }, _count: { _all: true } }),
      this.prisma.order.groupBy({ by: ['shopId'], where: frozenOrdersWhere(actorUserId, scope), _count: { _all: true } }),
    ]);
    const communityOf = await this.communitiesOfShops([pendingProducts, openDisputes, disputesAwaitingRuling, frozenOrders]);

    return {
      pendingShops,
      pendingProfileChanges,
      pendingProducts: rollUp(pendingProducts, communityOf),
      openDisputes: rollUp(openDisputes, communityOf),
      disputesAwaitingRuling: rollUp(disputesAwaitingRuling, communityOf),
      frozenOrders: rollUp(frozenOrders, communityOf),
    };
  }

  private async overviewTallies(
    scope: CommunityScope,
    range: ThaiDateRange,
  ): Promise<{ shops: Record<Exclude<keyof CommunityOverviewDto, 'ordersPlacedByStatus'>, Tally>; ordersPlaced: Map<string, Map<OrderStatus, number>> }> {
    const inScope = inCommunities(scope);
    const openApproved = { approvalStatus: 'APPROVED', closedAt: null, ...inScope } satisfies Prisma.ShopWhereInput;

    const [liveShops, suspendedShops, ownerBannedShops, liveProducts, ordersPlaced] = await Promise.all([
      this.byCommunity({ ...LIVE_SHOP_FILTER, ...inScope }),
      this.byCommunity({ ...openApproved, suspendedAt: { not: null } }),
      // Suspension wins when both apply: each shop is counted once, under the admin's own action.
      this.byCommunity({ ...openApproved, suspendedAt: null, owner: { bannedAt: { not: null } } }),
      this.prisma.product.groupBy({ by: ['shopId'], where: { ...PRODUCT_OWN_VISIBILITY_FILTER, shop: { ...LIVE_SHOP_FILTER, ...inScope } }, _count: { _all: true } }),
      this.prisma.order.groupBy({
        by: ['shopId', 'status'],
        where: { createdAt: { gte: range.start, lt: range.endExclusive }, shop: inScope },
        _count: { _all: true },
      }),
    ]);
    const communityOf = await this.communitiesOfShops([liveProducts, ordersPlaced]);

    const placed = new Map<string, Map<OrderStatus, number>>();
    for (const row of ordersPlaced) {
      const communityId = communityOf.get(row.shopId);
      if (communityId === undefined) continue;
      const statuses = placed.get(communityId) ?? new Map<OrderStatus, number>();
      statuses.set(row.status, (statuses.get(row.status) ?? 0) + row._count._all);
      placed.set(communityId, statuses);
    }

    return { shops: { liveShops, suspendedShops, ownerBannedShops, liveProducts: rollUp(liveProducts, communityOf) }, ordersPlaced: placed };
  }

  private async byCommunity(where: Prisma.ShopWhereInput): Promise<Tally> {
    const rows = await this.prisma.shop.groupBy({ by: ['communityId'], where, _count: { _all: true } });

    return new Map(rows.map((row) => [row.communityId, row._count._all]));
  }

  /** The community of every shop a by-shop tally mentions — one query for all of them. */
  private async communitiesOfShops(tallies: readonly (readonly { shopId: string }[])[]): Promise<Map<string, string>> {
    const shopIds = [...new Set(tallies.flatMap((rows) => rows.map((row) => row.shopId)))];
    if (shopIds.length === 0) {
      return new Map();
    }
    const shops = await this.prisma.shop.findMany({ where: { id: { in: shopIds } }, select: { id: true, communityId: true } });

    return new Map(shops.map((shop) => [shop.id, shop.communityId]));
  }
}

function rollUp(rows: readonly { shopId: string; _count: { _all: number } }[], communityOf: ReadonlyMap<string, string>): Tally {
  const tally = new Map<string, number>();
  for (const row of rows) {
    const communityId = communityOf.get(row.shopId);
    if (communityId !== undefined) {
      tally.set(communityId, (tally.get(communityId) ?? 0) + row._count._all);
    }
  }

  return tally;
}

/** Each tally added up over these communities — zero where a tally has no entry. */
function sumOver<K extends string>(tallies: Record<K, Tally>, communityIds: readonly string[]): Record<K, number> {
  return Object.fromEntries(
    Object.entries<Tally>(tallies).map(([field, tally]) => [field, communityIds.reduce((sum, id) => sum + (tally.get(id) ?? 0), 0)]),
  ) as Record<K, number>;
}

/** Every status present, zero where none — added up over the communities given. */
function statusCounts(perCommunity: readonly (ReadonlyMap<OrderStatus, number> | undefined)[]): OrderStatusCountsDto {
  return Object.fromEntries(
    Object.values(OrderStatus).map((status) => [status, perCommunity.reduce((sum, counts) => sum + (counts?.get(status) ?? 0), 0)]),
  ) as unknown as OrderStatusCountsDto;
}
