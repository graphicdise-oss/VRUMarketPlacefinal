import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * §91: what every approve/reject a community admin makes has to carry — the `reviewRevision` of
 * the product or shop as their screen showed it. An edit that landed after they opened it bumps
 * the revision, and the decision is refused with STALE_VIEW instead of landing on wording they
 * never saw.
 *
 * Required, with no default: a decision that does not say what it looked at is exactly the one
 * this exists to refuse.
 */
/** §110: the `integer` column's own ceiling — past it a revision could only be forged, and used to reach the database as a 500. */
const MAX_REVIEW_REVISION = 2_147_483_647;

export class ReviewDecisionDto {
  @ApiProperty({
    minimum: 0,
    maximum: MAX_REVIEW_REVISION,
    description:
      'The `reviewRevision` of the item as shown when the reviewer opened it — from the pending ' +
      'queue or the admin view. Send it back unchanged; never compute it.',
    example: 0,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_REVIEW_REVISION, { message: 'reviewRevision ไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' })
  reviewRevision!: number;
}
