import { ApiProperty } from '@nestjs/swagger';
import { ProductRejectionCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length } from 'class-validator';
import { ReviewDecisionDto } from '../../common/dto/review-decision.dto.js';

/** Same bounds as `RejectShopDto`'s reason — the same shape of admin decision. */
export const MIN_REJECTION_REASON_LENGTH = 10;
export const MAX_REJECTION_REASON_LENGTH = 500;

/**
 * #43 (H4): rejecting a product needs *both* a machine-readable category (what topics 7 and 10
 * branch on) and a human-readable reason (what the seller reads to know what to fix) — neither
 * one substitutes for the other. §91: carries the `reviewRevision` it was decided on, like approving.
 */
export class RejectProductDto extends ReviewDecisionDto {
  @ApiProperty({
    enum: ProductRejectionCategory,
    description:
      'NEEDS_FIX: an order in flight is unaffected. PROHIBITED: an unpaid order tied to this ' +
      'product is cancelled and its stock refunded; a paid one is frozen instead (topics 7/10).',
  })
  @IsEnum(ProductRejectionCategory)
  category!: ProductRejectionCategory;

  /** Shown to the seller (spec 5/12 user story 17). Also recorded in audit_log. */
  @ApiProperty({
    minLength: MIN_REJECTION_REASON_LENGTH,
    maxLength: MAX_REJECTION_REASON_LENGTH,
    example: 'รูปสินค้าเบลอเกินไป มองไม่เห็นรายละเอียด กรุณาอัปโหลดรูปใหม่ที่ชัดกว่านี้',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_REJECTION_REASON_LENGTH, MAX_REJECTION_REASON_LENGTH)
  reason!: string;
}
