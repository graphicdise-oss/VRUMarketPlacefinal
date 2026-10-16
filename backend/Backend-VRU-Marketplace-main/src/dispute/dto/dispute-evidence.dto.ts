import { ApiProperty } from '@nestjs/swagger';
import type { DisputeParty } from '@prisma/client';

export class DisputeEvidenceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['BUYER', 'SHOP'] })
  party!: DisputeParty;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(row: { id: string; party: DisputeParty; createdAt: Date }): DisputeEvidenceDto {
    const dto = new DisputeEvidenceDto();
    dto.id = row.id;
    dto.party = row.party;
    dto.createdAt = row.createdAt;

    return dto;
  }
}
