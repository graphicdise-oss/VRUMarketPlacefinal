import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';
import { MAX_SHOP_NAME_LENGTH } from '../common/shop-policy.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * #34: applying to open a shop. No payment channels yet — those are #36's column.
 *
 * #73 (N27): `name` is required here, not added later through a separate profile edit — every
 * public list/search/order page that shows a shop needs a name to show, so a shop is never
 * allowed to exist without one, even for the short window between applying and a first edit.
 * The bio and logo stay optional and are added afterward through `PATCH /shops/me` and
 * `POST /shops/me/logo` — name is the one field this ticket treats as identity, not decoration.
 */
export class ApplyShopDto {
  @ApiProperty({ format: 'uuid', description: 'Which community this shop will belong to.' })
  @IsUUID()
  communityId!: string;

  @ApiProperty({ maxLength: MAX_SHOP_NAME_LENGTH, description: "The shop's own display name." })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_SHOP_NAME_LENGTH)
  name!: string;
}
