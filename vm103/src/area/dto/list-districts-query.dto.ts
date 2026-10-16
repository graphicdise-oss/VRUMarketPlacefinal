import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/**
 * `provinceId` is required, not optional: the cascading picker this ticket exists for always has
 * a province chosen by the time it asks for districts (#46's "เลือกจังหวัด → ได้เฉพาะอำเภอของ
 * จังหวัดนั้น"), and an unfiltered list of all 930 districts is not a real use case here.
 */
export class ListDistrictsQueryDto extends PaginationQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  provinceId!: string;
}
