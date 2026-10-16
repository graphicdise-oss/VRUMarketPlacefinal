import { ApiProperty } from '@nestjs/swagger';
import type { District } from '@prisma/client';

export class DistrictDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nameTh!: string;

  @ApiProperty({ format: 'uuid' })
  provinceId!: string;

  static from(district: District): DistrictDto {
    const dto = new DistrictDto();
    dto.id = district.id;
    dto.nameTh = district.nameTh;
    dto.provinceId = district.provinceId;

    return dto;
  }
}
