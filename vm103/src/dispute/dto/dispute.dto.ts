import { ApiProperty } from '@nestjs/swagger';
import type { DisputeVerdict } from '@prisma/client';
import { DisputeEvidenceDto } from './dispute-evidence.dto.js';

/**
 * `Dispute` (#63/#64): the shape both the buyer who opened it and the shop it's about see — same
 * fields for both sides, the same "no reason for two views" precedent `OrderDto` set (a masked,
 * third view exists only for a community admin, and that is #62's `FrozenOrderAdminDto` — never
 * reused here since a dispute isn't a frozen order).
 */
export class DisputeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ nullable: true })
  shopResponse!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  respondedAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'null while open.' })
  closedAt!: Date | null;

  @ApiProperty({
    enum: ['BUYER_WINS', 'SHOP_WINS'],
    nullable: true,
    description: '#64 (K12): the current verdict — null until ruled. Overwritten in place by a super admin override (I9b), never a second row.',
  })
  verdict!: DisputeVerdict | null;

  @ApiProperty({ nullable: true, description: 'K12: the admin’s written reason — visible to both sides, the only explanation either gets (I9 cut appeals).' })
  rulingReason!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  ruledAt!: Date | null;

  @ApiProperty({ type: [DisputeEvidenceDto] })
  evidence!: DisputeEvidenceDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static from(row: {
    id: string;
    orderId: string;
    reason: string;
    shopResponse: string | null;
    respondedAt: Date | null;
    closedAt: Date | null;
    verdict: DisputeVerdict | null;
    rulingReason: string | null;
    ruledAt: Date | null;
    evidence: Parameters<typeof DisputeEvidenceDto.from>[0][];
    createdAt: Date;
    updatedAt: Date;
  }): DisputeDto {
    const dto = new DisputeDto();
    dto.id = row.id;
    dto.orderId = row.orderId;
    dto.reason = row.reason;
    dto.shopResponse = row.shopResponse;
    dto.respondedAt = row.respondedAt;
    dto.closedAt = row.closedAt;
    dto.verdict = row.verdict;
    dto.rulingReason = row.rulingReason;
    dto.ruledAt = row.ruledAt;
    dto.evidence = row.evidence.map((e) => DisputeEvidenceDto.from(e));
    dto.createdAt = row.createdAt;
    dto.updatedAt = row.updatedAt;

    return dto;
  }
}
