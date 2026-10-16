import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ProductModerationStatus, ProductRejectionCategory, ShopPublishStatus } from '@prisma/client';
import { availableStock, ReservedStock } from '../../order/reserved-stock.js';
import type { SoldQuantity } from '../../order/sold-quantity.js';
import { publicSuspendedAt } from '../../shop/shop-visibility.js';

type VariantRow = { id: string; name: string; priceAmountMinor: number; currency: string; stock: number };

/**
 * One option as anyone browsing sees it. §117: `stock` is what can still be ordered — physical
 * stock less what open orders hold — the "จำนวนคงเหลือ" the frontend was always told it is. Before,
 * it was the raw column: a product whose every unit sat reserved for up to ~13 days showed as in
 * stock and every checkout answered 409. The split between "on the shelf" and "held" is the
 * owner's (`OwnerProductVariantDto`), not the public's: both together would tell anyone a shop's
 * open sales.
 */
export class ProductVariantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Satang, integer.' })
  priceAmountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: '§117: units that can still be ordered — physical stock less what open orders hold. 0 means sold out.' })
  stock!: number;

  static from(row: VariantRow, reserved: ReservedStock = new Map()): ProductVariantDto {
    const dto = new ProductVariantDto();
    dto.id = row.id;
    dto.name = row.name;
    dto.priceAmountMinor = row.priceAmountMinor;
    dto.currency = row.currency;
    dto.stock = availableStock(row, reserved);

    return dto;
  }
}

/**
 * One option as its shop (and a reviewing admin) sees it — §117, owner's choice (option ก): the
 * shop may set `stock` to anything, below what is reserved included (goods break and sell
 * offline; the real count must always be enterable), but now sees what that means. A `stock`
 * under `reservedQuantity` is a shop that cannot confirm some paid orders (K8) — the screen warns,
 * nothing refuses.
 */
export class OwnerProductVariantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Satang, integer.' })
  priceAmountMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Physical stock, as the shop last entered it and payments since cut it — what `expectedStock` compares against.' })
  stock!: number;

  @ApiProperty({ description: '§117: units held by orders between checkout and the shop confirming payment. Cut from `stock` when the shop confirms.' })
  reservedQuantity!: number;

  @ApiProperty({ description: '§117: `stock − reservedQuantity`, never below 0 — what buyers see as `stock`.' })
  availableStock!: number;

  static from(row: VariantRow, reserved: ReservedStock = new Map()): OwnerProductVariantDto {
    const dto = new OwnerProductVariantDto();
    dto.id = row.id;
    dto.name = row.name;
    dto.priceAmountMinor = row.priceAmountMinor;
    dto.currency = row.currency;
    dto.stock = row.stock;
    dto.reservedQuantity = reserved.get(row.id) ?? 0;
    dto.availableStock = availableStock(row, reserved);

    return dto;
  }
}

export class ProductImageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(row: { id: string; createdAt: Date }): ProductImageDto {
    const dto = new ProductImageDto();
    dto.id = row.id;
    dto.createdAt = row.createdAt;

    return dto;
  }
}

/**
 * A product as its owner sees it (#41, `shopPublishStatus` added in #42) — the only view that
 * shows `moderationStatus` and `shopPublishStatus` at all, which a stranger browsing has no
 * business seeing before a product has been reviewed. The public view (`PublicProductDto` below)
 * is a different shape entirely, not this one with fields hidden.
 */
export class ProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  moderationStatus!: ProductModerationStatus;

  @ApiPropertyOptional({
    enum: ['NEEDS_FIX', 'PROHIBITED'],
    nullable: true,
    description: 'Set only alongside moderationStatus: REJECTED (#43 · H4).',
  })
  rejectionCategory!: ProductRejectionCategory | null;

  @ApiPropertyOptional({ nullable: true, description: 'The reviewer’s own words — read this alongside rejectionCategory.' })
  rejectionReason!: string | null;

  @ApiProperty({
    enum: ['PUBLISHED', 'UNPUBLISHED'],
    description: 'The shop’s own choice (#42) — independent of moderationStatus.',
  })
  shopPublishStatus!: ShopPublishStatus;

  @ApiProperty({
    description:
      '§91: goes up with every edit that sends the product back for review. A reviewer sends the ' +
      'value their screen showed with approve/reject; a later edit makes that decision STALE_VIEW.',
    example: 0,
  })
  reviewRevision!: number;

  @ApiProperty({ type: [OwnerProductVariantDto] })
  variants!: OwnerProductVariantDto[];

  @ApiProperty({ type: [ProductImageDto], description: 'In upload order. Fetch bytes at GET /products/:id/images/:imageId.' })
  images!: ProductImageDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static from(row: {
    id: string;
    shopId: string;
    name: string;
    description: string;
    categoryId: string;
    moderationStatus: ProductModerationStatus;
    rejectionCategory: ProductRejectionCategory | null;
    rejectionReason: string | null;
    shopPublishStatus: ShopPublishStatus;
    reviewRevision: number;
    variants: VariantRow[];
    images: { id: string; createdAt: Date }[];
    createdAt: Date;
    updatedAt: Date;
  }, reserved: ReservedStock = new Map()): ProductDto {
    const dto = new ProductDto();
    dto.id = row.id;
    dto.shopId = row.shopId;
    dto.name = row.name;
    dto.description = row.description;
    dto.categoryId = row.categoryId;
    dto.moderationStatus = row.moderationStatus;
    dto.rejectionCategory = row.rejectionCategory;
    dto.rejectionReason = row.rejectionReason;
    dto.shopPublishStatus = row.shopPublishStatus;
    dto.reviewRevision = row.reviewRevision;
    dto.variants = row.variants.map((variant) => OwnerProductVariantDto.from(variant, reserved));
    dto.images = row.images.map((image) => ProductImageDto.from(image));
    dto.createdAt = row.createdAt;
    dto.updatedAt = row.updatedAt;

    return dto;
  }
}

/**
 * A product as anyone sees it (#42) — signed in or not (invariant 1). Only ever built from a
 * product that passes `PRODUCT_OWN_VISIBILITY_FILTER` (list) or the narrower single-view rule in
 * `ProductService.findPublic` — there is nothing here to gate a second time, which is also why
 * neither `moderationStatus` nor `shopPublishStatus` appear: both are always true by construction
 * for anything this DTO is built from.
 *
 * `shopClosedAt`/`shopSuspendedAt` carry invariant 6's third layer through to a direct-link view
 * even when the shop itself is why the product is otherwise unlisted (I14) — `null` on both means
 * the shop is live. The list endpoint never returns a row with either set, because it filters on
 * `LIVE_SHOP_FILTER`; the single-product view can and does, on purpose.
 */
export class PublicProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty({ description: 'The category\'s name, so a card can show it without a second lookup.' })
  categoryNameTh!: string;

  @ApiProperty({ description: 'The owning shop\'s name.' })
  shopName!: string;

  @ApiProperty({ format: 'uuid', description: 'The community the owning shop belongs to — what `GET /products?communityId=` filters on.' })
  communityId!: string;

  @ApiProperty({ description: 'Units sold across every option: orders at PAID, SHIPPED or COMPLETED (cancelled and refunded orders are not counted).' })
  soldCount!: number;

  @ApiProperty({ type: [ProductVariantDto] })
  variants!: ProductVariantDto[];

  @ApiProperty({ type: [ProductImageDto] })
  images!: ProductImageDto[];

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Set means the owning shop is closed (#37) — show a badge, this is not a 404.',
  })
  shopClosedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description:
      'Set means the owning shop is suspended (#38 · I14), or its owner\'s account is banned (§92, ' +
      'shown the same way on purpose) — show a badge, this is not a 404.',
  })
  shopSuspendedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(row: {
    id: string;
    shopId: string;
    name: string;
    description: string;
    categoryId: string;
    category: { name: string };
    variants: VariantRow[];
    images: { id: string; createdAt: Date }[];
    shop: { name: string; communityId: string; closedAt: Date | null; suspendedAt: Date | null; owner: { bannedAt: Date | null } };
    createdAt: Date;
  }, reserved: ReservedStock = new Map(), sold: SoldQuantity = new Map()): PublicProductDto {
    const dto = new PublicProductDto();
    dto.id = row.id;
    dto.shopId = row.shopId;
    dto.name = row.name;
    dto.description = row.description;
    dto.categoryId = row.categoryId;
    dto.categoryNameTh = row.category.name;
    dto.shopName = row.shop.name;
    dto.communityId = row.shop.communityId;
    dto.soldCount = row.variants.reduce((total, variant) => total + (sold.get(variant.id) ?? 0), 0);
    dto.variants = row.variants.map((variant) => ProductVariantDto.from(variant, reserved));
    dto.images = row.images.map((image) => ProductImageDto.from(image));
    dto.shopClosedAt = row.shop.closedAt;
    dto.shopSuspendedAt = publicSuspendedAt(row.shop);
    dto.createdAt = row.createdAt;

    return dto;
  }
}
