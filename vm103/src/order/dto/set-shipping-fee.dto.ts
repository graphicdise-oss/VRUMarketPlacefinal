import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_SHIPPING_AMOUNT_MINOR } from '../common/order-policy.js';

/** H1: entered once, locked forever after — see `OrderService.setShippingFee`'s own comment. */
export class SetShippingFeeDto {
  @ApiProperty({
    description:
      'Satang, integer. Free shipping is a valid choice — 0 is allowed. Capped at 100,000 baht ' +
      '(§81) — an extra zero typed by accident would otherwise be locked in by H1.',
    minimum: 0,
    maximum: MAX_SHIPPING_AMOUNT_MINOR,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_SHIPPING_AMOUNT_MINOR, { message: 'ค่าส่งต้องไม่เกิน 100,000 บาท' })
  shippingAmountMinor!: number;
}
