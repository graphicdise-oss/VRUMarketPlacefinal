import { ApiProperty } from '@nestjs/swagger';
import { DashboardRangeDto, SalesDto, SalesTotalsDto } from './sales.dto.js';

/**
 * Waiting right now, whatever the range — each the length of the matching admin list, the caller's
 * own cases left out (N28) the same way those lists leave them out.
 */
export class AdminQueueDto {
  @ApiProperty({ description: 'GET /shops/pending' })
  pendingShops!: number;

  @ApiProperty({ description: 'GET /shops/pending-profile-changes' })
  pendingProfileChanges!: number;

  @ApiProperty({ description: 'GET /products/pending' })
  pendingProducts!: number;

  @ApiProperty({ description: 'GET /disputes/open — includes BUYER_WINS disputes still open for their refund loop.' })
  openDisputes!: number;

  @ApiProperty({ description: 'The open disputes with no ruling yet.' })
  disputesAwaitingRuling!: number;

  @ApiProperty({ description: 'GET /frozen-orders' })
  frozenOrders!: number;
}

export class OrderStatusCountsDto {
  @ApiProperty() AWAITING_SHIPPING_QUOTE!: number;
  @ApiProperty() AWAITING_PAYMENT!: number;
  @ApiProperty() PAYMENT_SUBMITTED!: number;
  @ApiProperty() PAID!: number;
  @ApiProperty() SHIPPED!: number;
  @ApiProperty() COMPLETED!: number;
  @ApiProperty() CANCELLED!: number;
  @ApiProperty() REFUND_ORDERED!: number;
  @ApiProperty() REFUNDED!: number;
}

export class CommunityOverviewDto {
  @ApiProperty({ description: 'Approved, open, not suspended, owner not banned — selling now.' })
  liveShops!: number;

  @ApiProperty({ description: 'Approved and open, suspended by an admin.' })
  suspendedShops!: number;

  @ApiProperty({ description: 'Approved, open and not suspended, but the owner is banned — stopped selling (§92).' })
  ownerBannedShops!: number;

  @ApiProperty({ description: 'Approved, published, not deleted, in a live shop — what buyers can find now.' })
  liveProducts!: number;

  @ApiProperty({ type: OrderStatusCountsDto, description: 'Orders placed in the range, by their status now.' })
  ordersPlacedByStatus!: OrderStatusCountsDto;
}

export class DashboardFiguresDto {
  @ApiProperty({ type: AdminQueueDto })
  queue!: AdminQueueDto;

  @ApiProperty({ type: CommunityOverviewDto })
  overview!: CommunityOverviewDto;

  @ApiProperty({ type: SalesDto })
  sales!: SalesDto;
}

/**
 * One community's row. Sales without the day-by-day series (scrutinize §127): a super admin's
 * year-long view would otherwise carry 366 points for every community — the chart is drawn from
 * `total`, which is one community's own figures when `communityId` narrows the dashboard to it.
 */
export class CommunityDashboardDto {
  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: AdminQueueDto })
  queue!: AdminQueueDto;

  @ApiProperty({ type: CommunityOverviewDto })
  overview!: CommunityOverviewDto;

  @ApiProperty({ type: SalesTotalsDto })
  sales!: SalesTotalsDto;
}

/**
 * §127: GET /admin/dashboard — one entry per community the caller administers (every community, for
 * a super admin), and the same figures added up.
 */
export class AdminDashboardDto {
  @ApiProperty({ type: DashboardRangeDto })
  range!: DashboardRangeDto;

  @ApiProperty({ type: [CommunityDashboardDto], description: 'Ordered by community name.' })
  communities!: CommunityDashboardDto[];

  @ApiProperty({ type: DashboardFiguresDto, description: 'Every community above, added up — with the day-by-day sales series.' })
  total!: DashboardFiguresDto;
}
