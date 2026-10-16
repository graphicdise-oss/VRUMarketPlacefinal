import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

export class ListShippingCarriersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Include retired carriers too — same default-excluded shape as GET /categories.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive = false;
}
