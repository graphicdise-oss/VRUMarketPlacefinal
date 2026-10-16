import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Same bounds as `RejectShopDto`'s reason — a low bar, the same shape of "must explain why". */
export const MIN_SHIPPING_FEE_REJECTION_REASON_LENGTH = 10;
export const MAX_SHIPPING_FEE_REJECTION_REASON_LENGTH = 500;

export class RejectShippingFeeDto {
  /**
   * Why. Required — an empty or missing reason is rejected, not defaulted to something generic
   * (#51's own AC). Stored in its own queryable column (`ShippingFeeRejection.reason`) rather
   * than `audit_log`'s free text, specifically so it can be aggregated into statistics later.
   */
  @ApiProperty({
    minLength: MIN_SHIPPING_FEE_REJECTION_REASON_LENGTH,
    maxLength: MAX_SHIPPING_FEE_REJECTION_REASON_LENGTH,
    example: 'ค่าส่งแพงกว่าที่คาดไว้มาก ไม่สะดวกจ่ายเพิ่ม',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_SHIPPING_FEE_REJECTION_REASON_LENGTH, MAX_SHIPPING_FEE_REJECTION_REASON_LENGTH)
  reason!: string;
}
