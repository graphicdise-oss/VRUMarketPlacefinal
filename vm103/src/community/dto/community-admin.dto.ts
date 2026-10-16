import { ApiProperty } from '@nestjs/swagger';
import type { CommunityAdmin } from '@prisma/client';

/** One `CommunityAdmin` row, as the super admin who manages it sees it. */
export class CommunityAdminDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty({ format: 'uuid', description: 'Who ran the assign request.' })
  assignedBy!: string;

  @ApiProperty({ format: 'date-time' })
  assignedAt!: Date;

  static from(row: CommunityAdmin): CommunityAdminDto {
    const dto = new CommunityAdminDto();
    dto.id = row.id;
    dto.userId = row.userId;
    dto.communityId = row.communityId;
    dto.assignedBy = row.assignedBy;
    dto.assignedAt = row.assignedAt;

    return dto;
  }
}
