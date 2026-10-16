import { ApiProperty } from '@nestjs/swagger';
import { addDays } from '../../time/clock.js';
import { EDIT_WINDOW_DAYS } from '../review-policy.js';
import { ReviewImageDto } from './review-image.dto.js';

/**
 * A review, as its own buyer, the shop it's about, or a stranger browsing all see the same shape
 * — no separate "admin view". **No author identity anywhere** (see the `Review` model's own
 * schema comment for why) — this is the entire reason G3's PDPA erasure has nothing review-shaped
 * left to redact.
 *
 * `deletedAt`/`deletionReason` are included here but never reach a stranger: the public shop-review
 * list (`ShopReviewController`) filters deleted rows out entirely before this DTO is ever built for
 * one, the same way a rejected `PaymentSlip` still shows its reason to the buyer who owns it. A
 * buyer whose own review a community admin removed can still see why, on their own order page.
 */
export class ReviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  rating!: number;

  @ApiProperty({ nullable: true })
  text!: string | null;

  @ApiProperty({ type: [ReviewImageDto] })
  images!: ReviewImageDto[];

  @ApiProperty({
    format: 'date-time',
    description: `I18: ${EDIT_WINDOW_DAYS} days after this — computed here so the frontend never has to know the window itself.`,
  })
  editableUntil!: Date;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'L3: set only when a community admin removed this review. The row stays; it just disappears from the public list.',
  })
  deletedAt!: Date | null;

  @ApiProperty({ nullable: true, description: 'The admin’s stated reason, shown to the review’s own author — same restraint as a rejected payment slip.' })
  deletionReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static from(row: {
    id: string;
    orderId: string;
    shopId: string;
    rating: number;
    text: string | null;
    images: Parameters<typeof ReviewImageDto.from>[0][];
    deletedAt: Date | null;
    deletionReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ReviewDto {
    const dto = new ReviewDto();
    dto.id = row.id;
    dto.orderId = row.orderId;
    dto.shopId = row.shopId;
    dto.rating = row.rating;
    dto.text = row.text;
    dto.images = row.images.map((image) => ReviewImageDto.from(image));
    dto.editableUntil = addDays(row.createdAt, EDIT_WINDOW_DAYS);
    dto.deletedAt = row.deletedAt;
    dto.deletionReason = row.deletionReason;
    dto.createdAt = row.createdAt;
    dto.updatedAt = row.updatedAt;

    return dto;
  }
}
