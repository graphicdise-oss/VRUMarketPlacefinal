import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AWAITING_SHOP_RESPONSE } from '../dispute/dispute-queue-filters.js';
import { ownedByShopOwner } from '../order/order.service.js';
import { availableStock, reservedStockOf } from '../order/reserved-stock.js';
import { SHOP_TODO, SHOP_WAITING } from '../order/shop-work.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PRODUCT_OWN_VISIBILITY_FILTER } from '../product/product-visibility.js';
import { ShopService } from '../shop/shop.service.js';
import { Clock } from '../time/clock.js';
import { combineSales, confirmedSales } from './confirmed-sales.js';
import { DashboardRangeDto, SalesDto } from './dto/sales.dto.js';
import { ShopCatalogDto, ShopDashboardDto, ShopTodoDto, ShopWaitingDto } from './dto/shop-dashboard.dto.js';
import { ThaiDateQuery, resolveThaiDateRange } from './thai-date-range.js';

/**
 * §127: the shop owner's dashboard — their own shop, from `findOwnShopRow` (404 without one, the
 * same as `GET /shops/me`). A suspended shop still gets it: suspension stops new sales, not the
 * orders already in progress (J2).
 *
 * Orders, disputes and sales are scoped the way `GET /shops/me/orders` is (`ownedByShopOwner` — every
 * shop this person has run, H12), so each order figure is the length of a list the owner can open.
 * The catalogue is the current shop's: products belong to a shop row, and a closed shop's are gone.
 */
@Injectable()
export class ShopDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: ShopService,
    private readonly clock: Clock,
  ) {}

  async forOwner(ownerId: string, query: ThaiDateQuery): Promise<ShopDashboardDto> {
    const range = resolveThaiDateRange(this.clock.now(), query);
    const shop = await this.shops.findOwnShopRow(ownerId);
    const owned = ownedByShopOwner(ownerId);

    const [todo, disputesAwaitingResponse, waiting, catalog, sales, ratings] = await Promise.all([
      this.countEach(owned, SHOP_TODO),
      this.prisma.dispute.count({ where: { order: owned, ...AWAITING_SHOP_RESPONSE } }),
      this.countEach(owned, SHOP_WAITING),
      this.catalogOf(shop.id),
      confirmedSales(this.prisma, { shopOwnerId: ownerId }, range),
      this.shops.reviewStatsFor([shop]),
    ]);
    const rating = ratings.get(shop.id) ?? { averageRating: null, reviewCount: 0 };

    return {
      range: DashboardRangeDto.from(range),
      shopId: shop.id,
      todo: { ...todo, disputesAwaitingResponse } satisfies ShopTodoDto,
      waiting: waiting satisfies ShopWaitingDto,
      catalog,
      sales: SalesDto.from(combineSales(range, sales.values())),
      rating: { averageRating: rating.averageRating, reviewCount: rating.reviewCount },
    };
  }

  private async countEach<K extends string>(owned: Prisma.OrderWhereInput, conditions: Record<K, Prisma.OrderWhereInput>): Promise<Record<K, number>> {
    const entries = await Promise.all(
      Object.entries<Prisma.OrderWhereInput>(conditions).map(async ([field, condition]) => [field, await this.prisma.order.count({ where: { ...owned, ...condition } })] as const),
    );

    return Object.fromEntries(entries) as Record<K, number>;
  }

  /**
   * The four review states do not overlap: pending and rejected whatever the shop's own switch says,
   * and an approved product either published (live) or hidden by the shop.
   */
  private async catalogOf(shopId: string): Promise<ShopCatalogDto> {
    const notDeleted = { shopId, deletedAt: null } satisfies Prisma.ProductWhereInput;
    const [live, pendingReview, rejected, hiddenByShop, liveVariants] = await Promise.all([
      this.prisma.product.count({ where: { ...notDeleted, ...PRODUCT_OWN_VISIBILITY_FILTER } }),
      this.prisma.product.count({ where: { ...notDeleted, moderationStatus: 'PENDING' } }),
      this.prisma.product.count({ where: { ...notDeleted, moderationStatus: 'REJECTED' } }),
      this.prisma.product.count({ where: { ...notDeleted, moderationStatus: 'APPROVED', shopPublishStatus: 'UNPUBLISHED' } }),
      this.prisma.productVariant.findMany({ where: { deletedAt: null, product: { ...notDeleted, ...PRODUCT_OWN_VISIBILITY_FILTER } }, select: { id: true, stock: true } }),
    ]);
    // §117: what a buyer can still order — the same figure the product page shows, reservations out.
    const reserved = await reservedStockOf(this.prisma, liveVariants.map((variant) => variant.id));
    const soldOutVariants = liveVariants.filter((variant) => availableStock(variant, reserved) === 0).length;

    return { live, pendingReview, rejected, hiddenByShop, soldOutVariants };
  }
}
