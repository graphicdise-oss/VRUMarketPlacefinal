import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The full row Prisma hands back once `subdistrictPostalCode` and its chain up to `province` are
 * included — the exact shape `AddressService` queries with everywhere this DTO is built from.
 */
export interface AddressRow {
  id: string;
  recipientName: string;
  phone: string;
  houseNumber: string;
  villageNumber: string | null;
  alley: string | null;
  road: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  subdistrictPostalCode: {
    id: string;
    postalCode: string;
    subdistrict: {
      id: string;
      nameTh: string;
      district: {
        id: string;
        nameTh: string;
        province: { id: string; nameTh: string };
      };
    };
  };
}

/**
 * An address as its owner sees it. There is no other view — spec 6/12's own AC rules out a
 * seller or a community admin ever reading this table directly (they see a snapshot on an order
 * instead, once topic 7 exists), so unlike `Shop`'s three-way split, one DTO is the whole story.
 *
 * Every field here is exactly what invariant 5's future order snapshot needs to copy — the
 * province/district/subdistrict names and the postal code are spelled out rather than left behind
 * a nested `subdistrictPostalCodeId` a caller would have to resolve separately, because a
 * snapshot has to copy text, not a foreign key that can drift.
 */
export class AddressDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  recipientName!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  houseNumber!: string;

  @ApiPropertyOptional({ nullable: true })
  villageNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  alley!: string | null;

  @ApiPropertyOptional({ nullable: true })
  road!: string | null;

  @ApiProperty({ format: 'uuid' })
  subdistrictPostalCodeId!: string;

  @ApiProperty()
  postalCode!: string;

  @ApiProperty({ format: 'uuid' })
  subdistrictId!: string;

  @ApiProperty()
  subdistrictNameTh!: string;

  @ApiProperty({ format: 'uuid' })
  districtId!: string;

  @ApiProperty()
  districtNameTh!: string;

  @ApiProperty({ format: 'uuid' })
  provinceId!: string;

  @ApiProperty()
  provinceNameTh!: string;

  @ApiProperty({
    description: 'At most one address per person has this set (enforced at the database — #47).',
  })
  isDefault!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static from(row: AddressRow): AddressDto {
    const dto = new AddressDto();
    dto.id = row.id;
    dto.recipientName = row.recipientName;
    dto.phone = row.phone;
    dto.houseNumber = row.houseNumber;
    dto.villageNumber = row.villageNumber;
    dto.alley = row.alley;
    dto.road = row.road;
    dto.subdistrictPostalCodeId = row.subdistrictPostalCode.id;
    dto.postalCode = row.subdistrictPostalCode.postalCode;
    dto.subdistrictId = row.subdistrictPostalCode.subdistrict.id;
    dto.subdistrictNameTh = row.subdistrictPostalCode.subdistrict.nameTh;
    dto.districtId = row.subdistrictPostalCode.subdistrict.district.id;
    dto.districtNameTh = row.subdistrictPostalCode.subdistrict.district.nameTh;
    dto.provinceId = row.subdistrictPostalCode.subdistrict.district.province.id;
    dto.provinceNameTh = row.subdistrictPostalCode.subdistrict.district.province.nameTh;
    dto.isDefault = row.isDefault;
    dto.createdAt = row.createdAt;
    dto.updatedAt = row.updatedAt;

    return dto;
  }
}
