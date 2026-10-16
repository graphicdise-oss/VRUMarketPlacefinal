import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Same bounds as `RejectShippingFeeDto`/`CancelOrderAsShopDto` — this project's one shape for "must explain why". */
export const MIN_SLIP_REJECTION_REASON_LENGTH = 10;
export const MAX_SLIP_REJECTION_REASON_LENGTH = 500;

/**
 * #56 (I2): required — a missing or empty reason is rejected, not defaulted, the same as every
 * other "explain why" field in this project. This is what the buyer reads to know what to fix
 * (wrong amount, wrong account, unreadable) before uploading again.
 */
export class RejectPaymentSlipDto {
  @ApiProperty({
    minLength: MIN_SLIP_REJECTION_REASON_LENGTH,
    maxLength: MAX_SLIP_REJECTION_REASON_LENGTH,
    example: 'ยอดโอนไม่ตรงกับยอดที่ต้องชำระ กรุณาตรวจสอบและโอนใหม่',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_SLIP_REJECTION_REASON_LENGTH, MAX_SLIP_REJECTION_REASON_LENGTH)
  reason!: string;
}
