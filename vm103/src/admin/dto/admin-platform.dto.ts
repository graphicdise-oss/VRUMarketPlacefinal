import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export enum BroadcastAudience {
  ALL = 'ALL',
  SELLERS = 'SELLERS',
  COMMUNITY_ADMINS = 'COMMUNITY_ADMINS',
}

export class BroadcastNotificationDto {
  @ApiProperty({ enum: BroadcastAudience })
  @IsEnum(BroadcastAudience)
  audience!: BroadcastAudience;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;
}

export class LocationStatsDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  sales!: number;

  @ApiProperty()
  orders!: number;

  @ApiProperty()
  communities!: number;

  @ApiProperty()
  issues!: number;
}

export class TrendPointDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  orders!: number;
}

export class IssueStatusDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  value!: number;
}

export class PlatformDashboardDto {
  @ApiProperty()
  totalCommunities!: number;

  @ApiProperty()
  totalAdmins!: number;

  @ApiProperty()
  totalUsers!: number;

  @ApiProperty()
  totalAppeals!: number;

  @ApiProperty()
  totalSales!: number;

  @ApiProperty()
  totalOrders!: number;

  @ApiProperty()
  bannedUsers!: number;

  @ApiProperty()
  pendingAppeals!: number;

  @ApiProperty()
  pendingShops!: number;

  @ApiProperty({ type: [LocationStatsDto] })
  salesByLocation!: LocationStatsDto[];

  @ApiProperty({ type: [TrendPointDto] })
  platformTrend!: TrendPointDto[];

  @ApiProperty({ type: [IssueStatusDto] })
  issueStatus!: IssueStatusDto[];
}
