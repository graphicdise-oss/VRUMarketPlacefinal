import { ApiProperty } from '@nestjs/swagger';
import { DashboardRangeDto } from './sales.dto.js';

export class PlatformUsersDto {
  @ApiProperty({ description: 'Accounts that exist — erased ones (PDPA) not counted.' })
  total!: number;

  @ApiProperty()
  emailVerified!: number;

  @ApiProperty()
  banned!: number;

  @ApiProperty({ description: 'Signed up in the range (and not erased since).' })
  signedUpInRange!: number;

  @ApiProperty({ description: 'Erasure requested and waiting for open orders to finish (H9).' })
  erasureQueued!: number;
}

export class CommunityRefDto {
  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty()
  name!: string;
}

export class PlatformCommunitiesDto {
  @ApiProperty()
  total!: number;

  @ApiProperty({
    type: [CommunityRefDto],
    description: 'Communities whose queue reaches no community admin — none assigned, or every one banned or erased (§102/§112). Ordered by name.',
  })
  withoutActiveAdmin!: CommunityRefDto[];
}

export class PlatformAdminsDto {
  @ApiProperty({ description: 'Super admins neither banned nor erased.' })
  superAdmins!: number;

  @ApiProperty({ description: 'People (not rows) who administer at least one community, neither banned nor erased.' })
  communityAdmins!: number;
}

/** §127: GET /admin/dashboard/platform — what only a super admin manages. Super admin only. */
export class PlatformDashboardDto {
  @ApiProperty({ type: DashboardRangeDto })
  range!: DashboardRangeDto;

  @ApiProperty({ type: PlatformUsersDto })
  users!: PlatformUsersDto;

  @ApiProperty({ type: PlatformCommunitiesDto })
  communities!: PlatformCommunitiesDto;

  @ApiProperty({ type: PlatformAdminsDto })
  admins!: PlatformAdminsDto;
}
