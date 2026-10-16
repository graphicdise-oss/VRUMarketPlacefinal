import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Same bounds as `RejectShippingFeeDto`'s reason — the same shape of "must explain why". */
export const MIN_CANCEL_REASON_LENGTH = 10;
export const MAX_CANCEL_REASON_LENGTH = 500;

/**
 * H11: unlike the buyer's cancel, the shop's reason is required — missing or empty is rejected,
 * not defaulted. This is also the shop's only way out of a shipping fee it entered wrong (H1
 * forbids editing it), so the AC calls this out explicitly as testable both ways.
 */
export class CancelOrderAsShopDto {
  @ApiProperty({
    minLength: MIN_CANCEL_REASON_LENGTH,
    maxLength: MAX_CANCEL_REASON_LENGTH,
    example: 'ใส่ค่าส่งผิดพลาด ขออภัยในความไม่สะดวก',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_CANCEL_REASON_LENGTH, MAX_CANCEL_REASON_LENGTH)
  reason!: string;
}
