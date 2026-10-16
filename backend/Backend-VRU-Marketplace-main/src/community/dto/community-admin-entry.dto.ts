import { ApiProperty } from '@nestjs/swagger';

/** §112: one admin of a community, as the super admin listing them sees it. */
export class CommunityAdminEntryDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ format: 'date-time' })
  assignedAt!: Date;

  @ApiProperty({ format: 'uuid', description: 'The super admin who appointed them.' })
  assignedBy!: string;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Set while the account is banned — still listed (N21: an unban brings the rights back), but not paged about the queue.',
  })
  bannedAt!: Date | null;

  static from(row: { userId: string; assignedAt: Date; assignedBy: string; user: { email: string; bannedAt: Date | null } }): CommunityAdminEntryDto {
    const dto = new CommunityAdminEntryDto();
    dto.userId = row.userId;
    dto.email = row.user.email;
    dto.assignedAt = row.assignedAt;
    dto.assignedBy = row.assignedBy;
    dto.bannedAt = row.user.bannedAt;

    return dto;
  }
}
