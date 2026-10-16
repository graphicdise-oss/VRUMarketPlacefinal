import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MAX_DELETION_REASON_LENGTH, MIN_DELETION_REASON_LENGTH } from '../review-policy.js';

/** L3: required — a community admin removing someone's review must say why. */
export class DeleteReviewDto {
  @ApiProperty({
    minLength: MIN_DELETION_REASON_LENGTH,
    maxLength: MAX_DELETION_REASON_LENGTH,
    example: 'ข้อความมีคำหยาบและพาดพิงบุคคลอื่นโดยไม่เกี่ยวกับการซื้อขาย',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_DELETION_REASON_LENGTH, MAX_DELETION_REASON_LENGTH)
  reason!: string;
}
