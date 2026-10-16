import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Shop, ShopApprovalStatus } from '@prisma/client';

/**
 * A shop as its own owner sees it (#34's user story 2: "เห็นสถานะ 'รอตรวจสอบ' หลังยื่น") — the
 * one view that shows `approvalStatus` while it is still `PENDING`, since the public views never
 * show a shop before it is `APPROVED`.
 */
export class MyShopDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty({ description: "The shop's own display name (#73, N27)." })
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'The shop’s own bio. Null means none set.' })
  description!: string | null;

  /** #73: same "id is an internal fetch detail" reasoning as `ShopDto.hasLogo`. */
  @ApiProperty()
  hasLogo!: boolean;

  @ApiProperty()
  hasBanner!: boolean;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  approvalStatus!: ShopApprovalStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, description: 'Null means open.' })
  closedAt!: Date | null;

  /** #38: J2 — suspended means no new sales, not a lock on finishing what's already in progress. */
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  suspendedAt!: Date | null;

  /** #35: only ever set alongside `approvalStatus: "REJECTED"`. Null otherwise. */
  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;

  /** §86: a profile change waiting for a community admin — the storefront still shows the fields above. */
  @ApiPropertyOptional({
    nullable: true,
    description: 'Proposed name awaiting review (§86). Null when no text change is waiting.',
  })
  pendingName!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Proposed description awaiting review — "" means "clear it". Null when no text change is waiting.',
  })
  pendingDescription!: string | null;

  @ApiProperty({
    description:
      'Whether a new logo is awaiting review (§86) — fetch it from GET /shops/me/pending-logo.',
  })
  hasPendingLogo!: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'When the waiting change was last submitted. Null when nothing is waiting.',
  })
  profileChangeRequestedAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why the last profile change was rejected (§86). Cleared by the next submission.',
  })
  profileChangeRejectionReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(shop: Shop): MyShopDto {
    const dto = new MyShopDto();
    dto.id = shop.id;
    dto.communityId = shop.communityId;
    dto.name = shop.name;
    dto.description = shop.description;
    dto.hasLogo = shop.logoFileId !== null;
    dto.hasBanner = shop.bannerFileId !== null;
    dto.approvalStatus = shop.approvalStatus;
    dto.closedAt = shop.closedAt;
    dto.suspendedAt = shop.suspendedAt;
    dto.rejectionReason = shop.rejectionReason;
    dto.pendingName = shop.pendingName;
    dto.pendingDescription = shop.pendingDescription;
    dto.hasPendingLogo = shop.pendingLogoFileId !== null;
    dto.profileChangeRequestedAt = shop.profileChangeRequestedAt;
    dto.profileChangeRejectionReason = shop.profileChangeRejectionReason;
    dto.createdAt = shop.createdAt;

    return dto;
  }
}
