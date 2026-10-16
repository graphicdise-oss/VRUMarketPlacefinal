import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { ReviewDecisionDto } from '../../common/dto/review-decision.dto.js';

/** Same bounds as `BanUserDto`'s reason — a low bar, and the same shape of admin decision. */
export const MIN_REJECTION_REASON_LENGTH = 10;
export const MAX_REJECTION_REASON_LENGTH = 500;

/** §91: used for both an application and a profile change — each carries the revision decided on. */
export class RejectShopDto extends ReviewDecisionDto {
  /**
   * Why. Required, and unlike a ban's reason (never shown to the banned account), **this one is
   * shown to the applicant** (#35's AC: "ผู้ยื่นอ่านเหตุผลนั้นได้") — it is the thing that lets
   * them fix whatever was wrong and apply again.
   */
  @ApiProperty({
    minLength: MIN_REJECTION_REASON_LENGTH,
    maxLength: MAX_REJECTION_REASON_LENGTH,
    description: 'Shown to the applicant on their own shop status. Also recorded in audit_log.',
    example: 'ชื่อร้านซ้ำกับร้านอื่นในชุมชนเดียวกัน กรุณาเปลี่ยนชื่อแล้วยื่นใหม่',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_REJECTION_REASON_LENGTH, MAX_REJECTION_REASON_LENGTH)
  reason!: string;
}
