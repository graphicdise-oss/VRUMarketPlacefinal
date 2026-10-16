import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/** L8: filtering by `communityId` is optional — omit it and every community's shops come back. */
export class ListShopsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one community. Omit for all.' })
  @IsOptional()
  @IsUUID()
  communityId?: string;
}
