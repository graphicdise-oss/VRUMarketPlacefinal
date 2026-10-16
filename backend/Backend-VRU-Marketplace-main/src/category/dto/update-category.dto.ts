import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto.js';

/**
 * Both fields, both required — same reasoning as `UpdateCommunityDto`: a partial PATCH is
 * validation machinery nothing here asks for, so editing means sending the whole thing back.
 *
 * `isActive` lives here rather than on a separate "retire" endpoint: L5 frames retiring as an
 * ordinary edit to the row (like renaming), not a distinct lifecycle action with its own audit
 * verb — this ticket only has `CATEGORY_UPDATED`, not `CATEGORY_RETIRED`.
 */
export class UpdateCategoryDto extends CreateCategoryDto {
  @ApiProperty({
    description: 'False retires the category — see CategoryDto.isActive for what that means.',
  })
  @IsBoolean()
  isActive!: boolean;
}
