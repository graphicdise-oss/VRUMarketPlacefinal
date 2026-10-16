import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MAX_SHOP_DESCRIPTION_LENGTH, MAX_SHOP_NAME_LENGTH } from '../common/shop-policy.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * #73: full replace of `name`/`description` — the same "send the whole thing back" shape as
 * `UpdateProductDto`/`UpdateAddressDto`/`UpdatePaymentChannelDto`, not a partial PATCH.
 *
 * `description` is a required string here even though the column is nullable: an empty string
 * means "no bio" and `ShopService` collapses it to `null` before writing, so there is exactly one
 * way to say "no description" rather than two (`null` from never having set one, empty string
 * from clearing one) that a frontend would have to treat identically anyway.
 *
 * Unlike `UpdateProductDto`, there is no invariant-6-style "reset to pending" side effect here —
 * `Shop.approvalStatus` is a one-time gate on whether this person may sell at all (spec 4/12), not
 * an ongoing moderation flag on the shop's own content the way `Product.moderationStatus` is. This
 * codebase never asked a community admin to re-review a shop's profile text, so this endpoint does
 * not invent that review step.
 */
export class UpdateShopDto {
  @ApiProperty({ maxLength: MAX_SHOP_NAME_LENGTH })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_SHOP_NAME_LENGTH)
  name!: string;

  @ApiProperty({ maxLength: MAX_SHOP_DESCRIPTION_LENGTH, description: 'Empty string means no bio.' })
  @Transform(trim)
  @IsString()
  @Length(0, MAX_SHOP_DESCRIPTION_LENGTH)
  description!: string;
}
