import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { publicSuspendedAt } from '../common/shop-visibility.js';

/**
 * A shop as anyone sees it — signed in or not (invariant 1: browsing needs no session, and
 * community is a filter a client applies, not a membership check). Deliberately omits `ownerId`:
 * a stranger being able to map every shop straight to a specific account is not something this
 * marketplace needs to offer — `name` (#73) is the public identity shown instead.
 *
 * Only ever built from a shop that is `APPROVED` — `ShopService` enforces that before this DTO
 * is reached, so there is nothing here to gate a second time. `closedAt` and `suspendedAt` may
 * still be set: both keep the direct link working (#37, #38) so an old order page pointing at
 * this id does not break, even though the shop is filtered out of the list and search a stranger
 * browses — see `LIVE_SHOP_FILTER` for that filter, and `ShopService.findPublic` for why the
 * single view does not use it.
 */
export class ShopDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty({ description: 'The name of the community this shop belongs to.' })
  communityName!: string;

  @ApiProperty({ description: "The shop's own display name (#73, N27)." })
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'The shop’s own bio. Null means none set.' })
  description!: string | null;

  /**
   * #73: `hasLogo` rather than the underlying file id — same reasoning `PaymentChannelDto.hasQrImage`
   * already gives: the id is an internal detail of how the logo is fetched
   * (`GET /shops/:shopId/logo` resolves it server-side), not something a caller needs directly.
   */
  @ApiProperty()
  hasLogo!: boolean;

  @ApiProperty()
  hasBanner!: boolean;

  @ApiPropertyOptional({ nullable: true })
  province!: string | null;

  @ApiProperty()
  productCount!: number;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      'Set means the shop has closed. Still reachable by direct link (#37) — just no longer in ' +
      'the list or search results.',
  })
  closedAt!: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      'Set means the shop is suspended — by a community admin (J2, I14), or because its owner\'s ' +
      'account is banned (§92, shown the same way on purpose). Still reachable by direct link, ' +
      'never 404 — show "ร้านนี้ถูกระงับชั่วคราว" rather than treat this like closedAt.',
  })
  suspendedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  /**
   * I12: the owner's dispute record, not the shop's — see the field's comment on `User` for why.
   * Shown here so a buyer can weigh the risk before transferring money (spec 4/12 user story 19),
   * which only means something read off the person actually accountable for the last shop too.
   */
  @ApiProperty({ description: "The owner's lifetime count of disputes ruled against them (I12)." })
  disputeLostCount!: number;

  /**
   * K10 ("คะแนนร้านคิดจากค่าเฉลี่ยของดาว"): the average of every non-deleted `Review.rating`
   * against this shop (#60), rounded to one decimal place — null rather than 0 when there are none
   * yet, the same reasoning `Order.totalAmountMinor` stays null instead of defaulting to a number
   * that would misrepresent "nothing here" as "zero of something real".
   */
  @ApiProperty({ nullable: true, description: 'Average of non-deleted review ratings, one decimal place. Null means no reviews yet.' })
  averageRating!: number | null;

  @ApiProperty({ description: 'Count of non-deleted reviews this shop has received.' })
  reviewCount!: number;

  static from(
    shop: {
      id: string;
      communityId: string;
      name: string;
      description: string | null;
      logoFileId: string | null;
      bannerFileId: string | null;
      province: string | null;
      closedAt: Date | null;
      suspendedAt: Date | null;
      createdAt: Date;
      owner: { disputeLostCount: number; bannedAt: Date | null };
      community: { name: string };
      _count?: { products: number };
    },
    reviewStats: { averageRating: number | null; reviewCount: number },
  ): ShopDto {
    const dto = new ShopDto();
    dto.id = shop.id;
    dto.communityId = shop.communityId;
    dto.communityName = shop.community.name;
    dto.name = shop.name;
    dto.description = shop.description;
    dto.hasLogo = shop.logoFileId !== null;
    dto.hasBanner = shop.bannerFileId !== null;
    dto.province = shop.province;
    dto.closedAt = shop.closedAt;
    dto.suspendedAt = publicSuspendedAt(shop);
    dto.createdAt = shop.createdAt;
    dto.disputeLostCount = shop.owner.disputeLostCount;
    dto.averageRating = reviewStats.averageRating;
    dto.reviewCount = reviewStats.reviewCount;
    dto.productCount = shop._count?.products ?? 0;

    return dto;
  }
}
