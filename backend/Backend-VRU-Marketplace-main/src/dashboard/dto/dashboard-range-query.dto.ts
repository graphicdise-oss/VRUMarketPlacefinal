import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { DEFAULT_RANGE_DAYS, ISO_DATE, ISO_DATE_MESSAGE, MAX_RANGE_DAYS, ThaiDateQuery } from '../thai-date-range.js';

/**
 * §127: the period a dashboard's sales and "new in this period" figures cover — Thai calendar
 * dates, both ends included. The shape is checked here; whether the dates are real and in order is
 * checked by `resolveThaiDateRange`, which also knows what "today" is.
 */
export class DashboardRangeQueryDto implements ThaiDateQuery {
  @ApiPropertyOptional({
    example: '2026-09-06',
    description: `First Thai calendar day (YYYY-MM-DD), included. Default: ${DEFAULT_RANGE_DAYS} days before \`to\`. At most ${MAX_RANGE_DAYS} days in all.`,
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: ISO_DATE_MESSAGE })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-05', description: 'Last Thai calendar day (YYYY-MM-DD), included. Default: today in Thailand.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: ISO_DATE_MESSAGE })
  to?: string;
}

export class AdminDashboardQueryDto extends DashboardRangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only this community — one the caller administers (any, for a super admin).' })
  @IsOptional()
  @IsUUID()
  communityId?: string;
}
