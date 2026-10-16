import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Shop, ShopApprovalStatus } from '@prisma/client';

/**
 * A shop as the community admin who administers it (or a super admin) sees it — the same fields
 * as `ShopDto` plus `ownerId` and the lifecycle fields a moderator needs (`approvalStatus`,
 * `closedAt`) that the public view has no reason to carry. Reachable only through
 * `CommunityScopeGuard` (#32), so knowing who owns a shop, and whether it is pending, stays with
 * the people who could act on it: this community's admins and the platform's.
 */
export class ShopAdminDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty({ description: "The owner's email address" })
  ownerEmail!: string;

  @ApiProperty({ description: "The shop's own display name (#73, N27)." })
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'The shop’s own bio. Null means none set.' })
  description!: string | null;

  /** #73: same "id is an internal fetch detail" reasoning as `ShopDto.hasLogo`. */
  @ApiProperty()
  hasLogo!: boolean;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  approvalStatus!: ShopApprovalStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, description: 'Null means open.' })
  closedAt!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  suspendedAt!: Date | null;

  /**
   * §93 (owner's decision): why a shop that is not suspended has still left every list — its
   * owner's account is banned (§92). Admin-only on purpose: the public view reports the ban as
   * `suspendedAt` and never says an account was banned.
   */
  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      "Set means the owner's account is banned (§92): the shop is hidden and takes no new orders, " +
      'though suspendedAt stays null. Lifting the ban (super admin) is what brings it back — ' +
      'unsuspending does not.',
  })
  ownerBannedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;

  /**
   * §97 (owner's decision after review): the current account's own losses, next to the earlier
   * account's below — without it an owner reapplying on the same account (H12) showed a clean 0
   * while one who erased and came back showed their record. Public already (`ShopDto`), so nothing new leaks.
   */
  @ApiProperty({
    minimum: 0,
    example: 0,
    description: "The owner's current account's own disputeLostCount — the same number the public shop page shows.",
  })
  ownerDisputeLostCount!: number;

  /**
   * §97 (K16): disputes lost by an erased earlier account under the owner's email address — the
   * one thing K16 lets follow a person into a new account, and only onto the admin's screen.
   */
  @ApiProperty({
    minimum: 0,
    example: 0,
    description:
      'K16: how many disputes an earlier, erased account with the owner’s email address lost. ' +
      '0 when there was none (or it lost none — deliberately indistinguishable). Admin-only: never ' +
      'added to the public disputeLostCount, which counts the current account alone.',
  })
  ownerPriorDisputeLostCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    description:
      '§91: send this back unchanged with approve/reject. It goes up with every edit the owner ' +
      'submits for review, so a decision taken on an older screen answers STALE_VIEW.',
    example: 0,
  })
  reviewRevision!: number;

  @ApiProperty()
  followerCount!: number;

  static from(shop: Shop & { owner: { bannedAt: Date | null; disputeLostCount: number; email: string }; _count?: { followers: number } }, ownerPriorDisputeLostCount: number): ShopAdminDto {
    const dto = new ShopAdminDto();
    dto.reviewRevision = shop.reviewRevision;
    dto.id = shop.id;
    dto.communityId = shop.communityId;
    dto.ownerId = shop.ownerId;
    dto.ownerEmail = shop.owner.email;
    dto.name = shop.name;
    dto.description = shop.description;
    dto.hasLogo = shop.logoFileId !== null;
    dto.approvalStatus = shop.approvalStatus;
    dto.closedAt = shop.closedAt;
    dto.suspendedAt = shop.suspendedAt;
    dto.ownerBannedAt = shop.owner.bannedAt;
    dto.rejectionReason = shop.rejectionReason;
    dto.ownerDisputeLostCount = shop.owner.disputeLostCount;
    dto.ownerPriorDisputeLostCount = ownerPriorDisputeLostCount;
    dto.createdAt = shop.createdAt;
    dto.followerCount = shop._count?.followers ?? 0;

    return dto;
  }
}
