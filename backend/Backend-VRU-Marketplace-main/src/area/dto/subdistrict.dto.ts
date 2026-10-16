import { ApiProperty } from '@nestjs/swagger';

/**
 * One postal code a subdistrict answers to, with the id an address form sends back as
 * `subdistrictPostalCodeId` (#47) — not the postal code string alone, because #47's `Address`
 * references this exact row so a saved address's subdistrict and postal code can never disagree
 * (see that model's own comment). The postal code text is still here so a picker can show it
 * without a second lookup.
 */
export class SubdistrictPostalCodeDto {
  @ApiProperty({ format: 'uuid', description: 'Send this back as Address.subdistrictPostalCodeId.' })
  id!: string;

  @ApiProperty()
  postalCode!: string;
}

/**
 * A subdistrict together with its postal code(s) — fetched in one call so selecting a
 * subdistrict from a `GET /subdistricts?districtId=` list never needs a second round trip to
 * learn the postal code(s) (#46). `postalCodes` is an array on purpose: K7 requires the schema to
 * allow more than one per subdistrict, even though this dataset's own subdistricts each have
 * exactly one — see docs/DECISIONS.md.
 */
export class SubdistrictDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nameTh!: string;

  @ApiProperty({ format: 'uuid' })
  districtId!: string;

  @ApiProperty({ type: () => [SubdistrictPostalCodeDto] })
  postalCodes!: SubdistrictPostalCodeDto[];

  static from(subdistrict: {
    id: string;
    nameTh: string;
    districtId: string;
    postalCodes: { id: string; postalCode: string }[];
  }): SubdistrictDto {
    const dto = new SubdistrictDto();
    dto.id = subdistrict.id;
    dto.nameTh = subdistrict.nameTh;
    dto.districtId = subdistrict.districtId;
    dto.postalCodes = subdistrict.postalCodes.map((row) => {
      const postalCode = new SubdistrictPostalCodeDto();
      postalCode.id = row.id;
      postalCode.postalCode = row.postalCode;
      return postalCode;
    });

    return dto;
  }
}
