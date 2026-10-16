import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

export class ListCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Include retired categories too. Public like the rest of this endpoint — a retired ' +
      'category’s name is not sensitive, and a search page never needs this unless it is ' +
      'building an admin-facing list rather than a filter.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive = false;
}
