import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/** L8: filtering by `communityId` is optional, same as `ListShopsQueryDto` — omit it for every community. */
export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one community. Omit for all.' })
  @IsOptional()
  @IsUUID()
  communityId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '§110: restrict to one category. Omit for all. Combines with communityId.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one shop. Omit for all.' })
  @IsOptional()
  @IsUUID()
  shopId?: string;
}
