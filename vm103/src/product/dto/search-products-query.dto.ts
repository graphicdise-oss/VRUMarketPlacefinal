import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * `q` is required and non-empty — an empty search is `GET /products` (#42), not this route. No
 * upper bound beyond what the column itself allows (`MAX_PRODUCT_NAME_LENGTH`): a longer query
 * simply cannot match anything and is cheap to run either way.
 */
export class SearchProductsQueryDto extends PaginationQueryDto {
  @ApiProperty({ minLength: 1, description: 'Matched against product name with pg_trgm (N5) — ILIKE substring, plus <% for typo tolerance.' })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  q!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one community. Omit for all.' })
  @IsOptional()
  @IsUUID()
  communityId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '§110: restrict to one category. Omit for all. Combines with communityId.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
