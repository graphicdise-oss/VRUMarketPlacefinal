import { ApiProperty } from '@nestjs/swagger';
import type { Category } from '@prisma/client';

/**
 * A category, as anyone sees it — signed in or not (no session needed to build the filter list a
 * search page uses). Nothing here is sensitive, so unlike MeDto there is no field this
 * deliberately omits.
 */
export class CategoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description:
      'False means a shop can no longer choose this for a new or edited product — existing ' +
      'products keep it.',
  })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(category: Category): CategoryDto {
    const dto = new CategoryDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.isActive = category.isActive;
    dto.createdAt = category.createdAt;

    return dto;
  }
}
