import { ApiProperty } from '@nestjs/swagger';
import type { Province } from '@prisma/client';

export class ProvinceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nameTh!: string;

  static from(province: Province): ProvinceDto {
    const dto = new ProvinceDto();
    dto.id = province.id;
    dto.nameTh = province.nameTh;

    return dto;
  }
}
