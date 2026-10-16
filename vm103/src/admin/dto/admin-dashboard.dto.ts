import { ApiProperty } from '@nestjs/swagger';

export class AdminDashboardQueuesDto {
  @ApiProperty()
  pendingShopApprovals!: number;

  @ApiProperty()
  pendingShopEdits!: number;

  @ApiProperty()
  pendingProductChecks!: number;

  @ApiProperty()
  openDisputes!: number;

  @ApiProperty()
  frozenOrders!: number;
}

export class AdminDashboardOverviewDto {
  @ApiProperty()
  activeShops!: number;

  @ApiProperty()
  suspendedShops!: number;

  @ApiProperty()
  bannedOwners!: number;

  @ApiProperty()
  activeProducts!: number;

  @ApiProperty()
  ordersByStatus!: Record<string, number>;
}

export class AdminTrendDataDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  sales!: number;
}

export class AdminDashboardSalesDto {
  @ApiProperty()
  totalSales!: number;

  @ApiProperty({ type: [AdminTrendDataDto] })
  trend!: AdminTrendDataDto[];
}

export class AdminDashboardDto {
  @ApiProperty()
  queues!: AdminDashboardQueuesDto;

  @ApiProperty()
  overview!: AdminDashboardOverviewDto;

  @ApiProperty()
  sales!: AdminDashboardSalesDto;
}
