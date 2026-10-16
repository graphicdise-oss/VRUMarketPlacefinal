import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import {
  MAX_ALLEY_LENGTH,
  MAX_HOUSE_NUMBER_LENGTH,
  MAX_RECIPIENT_NAME_LENGTH,
  MAX_ROAD_LENGTH,
  MAX_VILLAGE_NUMBER_LENGTH,
  PHONE_PATTERN,
} from '../address-policy.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * Same as `trim`, but for the three optional fields below: an empty string after trimming
 * (`""`, or whitespace-only) becomes `undefined` rather than surviving as `""`.
 *
 * §80: `@IsOptional()` only skips `null`/`undefined` — it does not stop a plain `""` from
 * reaching `@IsString()`/`@MaxLength()`, both of which accept it happily. A normal form that
 * submits "" for a field the buyer left blank was therefore storing an empty string on a nullable
 * column instead of `null`, and topic 7's order snapshot would go on to copy that empty string
 * forward forever. Folding "blank" into "not provided" here means `AddressService`'s existing
 * `?? null` finally does what its shape implies.
 */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * #47: a delivery address, in the standard fields spec 6/12's AC asks for — not one free-text
 * blob. `subdistrictPostalCodeId` is the one field that is not free text at all: it has to be a
 * real row in #46's reference tables (the AC's own words: "ห้ามรับเป็นข้อความอิสระ"), checked by
 * `AddressService` against the database rather than by any validator here, because "does this id
 * exist" is not a shape a decorator can check.
 */
export class CreateAddressDto {
  @ApiProperty({ maxLength: MAX_RECIPIENT_NAME_LENGTH, example: 'สมชาย ใจดี' })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_RECIPIENT_NAME_LENGTH)
  recipientName!: string;

  @ApiProperty({
    description: 'Thai phone number, digits only, leading 0 — 9 digits for a landline, 10 for a mobile.',
    example: '0812345678',
  })
  @Transform(trim)
  @Matches(PHONE_PATTERN, { message: 'เบอร์โทรไม่ถูกต้อง' })
  phone!: string;

  @ApiProperty({ maxLength: MAX_HOUSE_NUMBER_LENGTH, example: '99/9' })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_HOUSE_NUMBER_LENGTH)
  houseNumber!: string;

  @ApiPropertyOptional({ maxLength: MAX_VILLAGE_NUMBER_LENGTH, description: 'หมู่ที่', example: '4' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(MAX_VILLAGE_NUMBER_LENGTH)
  villageNumber?: string;

  @ApiPropertyOptional({ maxLength: MAX_ALLEY_LENGTH, description: 'ตรอก/ซอย' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(MAX_ALLEY_LENGTH)
  alley?: string;

  @ApiPropertyOptional({ maxLength: MAX_ROAD_LENGTH, description: 'ถนน' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(MAX_ROAD_LENGTH)
  road?: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'A row from GET /subdistricts’ postalCodes (#46) — the specific postal code this address ' +
      'uses, which is also how the subdistrict/district/province chain is reached.',
  })
  @IsUUID()
  subdistrictPostalCodeId!: string;
}
