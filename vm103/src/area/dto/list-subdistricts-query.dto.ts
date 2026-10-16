import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/** `districtId` required, same reasoning as `ListDistrictsQueryDto.provinceId`. */
export class ListSubdistrictsQueryDto extends PaginationQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  districtId!: string;
}
