import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { MAX_CART_LINES } from '../../cart/cart-policy.js';

/** §111: one cart line as the buyer's screen showed it when they pressed "order". */
export class CheckoutLineDto {
  @ApiProperty({ format: 'uuid', description: 'A cart line `id` from GET /cart.' })
  @IsUUID()
  cartItemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0, description: 'The `priceAmountMinor` the screen showed, satang.' })
  @IsInt()
  @Min(0)
  priceAmountMinor!: number;
}

export class CheckoutShopCouponDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  shopId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  couponId!: string;
}

/** One address, used for every order the checkout splits into (D1's own AC: "เลือกที่อยู่ชุดเดียว"). */
export class CheckoutDto {
  @ApiProperty({ format: 'uuid', description: 'One of the caller’s own saved addresses (#47).' })
  @IsUUID()
  addressId!: string;

  @ApiProperty({
    type: [CheckoutLineDto],
    maxItems: MAX_CART_LINES,
    description:
      '§111: every orderable line the screen showed, with its quantity and price. Anything that no ' +
      'longer matches the cart — a price the shop changed, a quantity changed in another tab, a line ' +
      'added, removed or no longer orderable — answers 409 STALE_VIEW: reload the cart and confirm again.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  items!: CheckoutLineDto[];

  @ApiPropertyOptional({
    type: [CheckoutShopCouponDto],
    description: 'Selected coupon vouchers per shop',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutShopCouponDto)
  coupons?: CheckoutShopCouponDto[];

  @ApiPropertyOptional({ format: 'uuid', description: 'Single shop checkout couponId shorthand' })
  @IsOptional()
  @IsUUID()
  couponId?: string;
}
