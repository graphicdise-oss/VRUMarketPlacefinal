import { ApiProperty } from '@nestjs/swagger';
import type { SalesSummary } from '../confirmed-sales.js';
import { DASHBOARD_TIME_ZONE, ThaiDateRange } from '../thai-date-range.js';

export class DashboardRangeDto {
  @ApiProperty({ example: '2026-09-06', description: 'First Thai calendar day covered, included.' })
  from!: string;

  @ApiProperty({ example: '2026-10-05', description: 'Last Thai calendar day covered, included.' })
  to!: string;

  @ApiProperty({ example: 'Asia/Bangkok' })
  timeZone!: string;

  static from(range: ThaiDateRange): DashboardRangeDto {
    const dto = new DashboardRangeDto();
    dto.from = range.from;
    dto.to = range.to;
    dto.timeZone = DASHBOARD_TIME_ZONE;

    return dto;
  }
}

export class DailySalesDto {
  @ApiProperty({ example: '2026-10-05', description: 'Thai calendar day.' })
  date!: string;

  @ApiProperty()
  orderCount!: number;

  @ApiProperty({ description: 'Satang.' })
  amountMinor!: number;
}

/**
 * §127: what shops confirmed receiving in the range (invariant 2 — the platform never sees the
 * money). Orders sent back to the buyer are not counted. Includes shipping.
 */
export class SalesTotalsDto {
  @ApiProperty({ description: 'Orders whose shop confirmed the payment in the range, not since refunded.' })
  orderCount!: number;

  @ApiProperty({ description: 'Their totals, shipping included, in satang.' })
  amountMinor!: number;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  static from(summary: SalesSummary): SalesTotalsDto {
    const dto = new SalesTotalsDto();
    dto.orderCount = summary.orderCount;
    dto.amountMinor = summary.amountMinor;
    dto.currency = 'THB';

    return dto;
  }
}

/** The totals plus a point for every day — for the one figure a dashboard charts. */
export class SalesDto extends SalesTotalsDto {
  @ApiProperty({ type: [DailySalesDto], description: 'One entry for every day of the range, oldest first — zero on a day with none.' })
  daily!: DailySalesDto[];

  static override from(summary: SalesSummary): SalesDto {
    const dto = new SalesDto();
    Object.assign(dto, SalesTotalsDto.from(summary));
    dto.daily = [...summary.daily];

    return dto;
  }
}
