import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Shop } from '@prisma/client';

/**
 * §86: one shop's waiting profile change, as the community admin reviewing it sees it — the
 * storefront's current values beside the proposed ones, so the admin judges the change rather than
 * the whole shop again. The proposed logo itself is fetched from `GET /shops/:shopId/pending-logo`.
 */
export class ShopProfileChangeDto {
  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty({ description: 'What the storefront shows now.' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty()
  hasLogo!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The proposed name. Null means the text is not part of this change (only the logo is).',
  })
  pendingName!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The proposed description — "" means the owner wants it cleared. Null when the text is not part of this change.',
  })
  pendingDescription!: string | null;

  @ApiProperty({ description: 'Whether a new logo is part of this change.' })
  hasPendingLogo!: boolean;

  @ApiProperty({ format: 'date-time' })
  requestedAt!: Date;

  @ApiProperty({
    description:
      '§91: send this back unchanged with approve/reject. It goes up with every edit the owner ' +
      'submits for review, so a decision taken on an older screen answers STALE_VIEW.',
    example: 0,
  })
  reviewRevision!: number;

  static from(shop: Shop): ShopProfileChangeDto {
    const dto = new ShopProfileChangeDto();
    dto.reviewRevision = shop.reviewRevision;
    dto.shopId = shop.id;
    dto.communityId = shop.communityId;
    dto.name = shop.name;
    dto.description = shop.description;
    dto.hasLogo = shop.logoFileId !== null;
    dto.pendingName = shop.pendingName;
    dto.pendingDescription = shop.pendingDescription;
    dto.hasPendingLogo = shop.pendingLogoFileId !== null;
    // Only ever built for a shop in the queue, where this is set by definition.
    dto.requestedAt = shop.profileChangeRequestedAt ?? shop.createdAt;

    return dto;
  }
}
