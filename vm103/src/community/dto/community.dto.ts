import { ApiProperty } from '@nestjs/swagger';
import type { Community } from '@prisma/client';

/**
 * A community, as every caller sees it — signed in or not (invariant 1: reading needs no
 * session). Nothing here is sensitive, so unlike MeDto there is no field this deliberately omits.
 */
export class CommunityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(community: Community): CommunityDto {
    const dto = new CommunityDto();
    dto.id = community.id;
    dto.name = community.name;
    dto.description = community.description;
    dto.createdAt = community.createdAt;

    return dto;
  }
}
