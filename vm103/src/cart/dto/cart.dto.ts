import { ApiProperty } from '@nestjs/swagger';
import { availableStock, ReservedStock } from '../../order/reserved-stock.js';

/** §111: why a line cannot become an order — the first one that applies, in this order. */
export const CART_LINE_UNAVAILABLE_REASONS = ['VARIANT_DELETED', 'SHOP_UNAVAILABLE', 'PRODUCT_UNAVAILABLE'] as const;
export type CartLineUnavailableReason = (typeof CART_LINE_UNAVAILABLE_REASONS)[number];

/**
 * A cart line as its owner sees it. Price and stock are read live off the variant every time —
 * K4 forbids freezing them here, unlike `OrderItem.priceAtPurchase` once invariant 5 starts.
 */
export class CartItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  variantId!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({
    description:
      'The live name while the line is orderable; once it is not, the name from when it was added ' +
      '(§111) — the live one may be a rename moderation has not passed yet.',
  })
  productName!: string;

  @ApiProperty({ description: 'Same rule as `productName`.' })
  variantName!: string;

  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ description: 'Satang, integer — the current price, not what it was when added.' })
  priceAmountMinor!: number;

  @ApiProperty({
    description:
      '§111 (K4): the price the last time the buyer added this line or changed its quantity. ' +
      'Differs from `priceAmountMinor` → show "the price changed from X". Changing the quantity or ' +
      'adding again resets it.',
  })
  priceAmountMinorWhenAdded!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'The variant’s current stock. The cart never reserves it (#50 does, at order time).' })
  stock!: number;

  @ApiProperty({
    description:
      'False when this item can no longer become an order — the variant was deleted, or the ' +
      'product/shop no longer passes invariant 6’s visibility (#42). Still shown, not silently ' +
      'dropped, so the buyer can remove it themselves and see why.',
  })
  orderable!: boolean;

  @ApiProperty({
    enum: CART_LINE_UNAVAILABLE_REASONS,
    nullable: true,
    description:
      '§111: null exactly when `orderable`. VARIANT_DELETED — the shop removed this option · ' +
      'SHOP_UNAVAILABLE — the shop is suspended or closed · PRODUCT_UNAVAILABLE — the product is not on sale ' +
      '(unpublished by the shop, or under review).',
  })
  unavailableReason!: CartLineUnavailableReason | null;

  static from(
    row: {
      id: string;
      quantity: number;
      priceAmountMinorWhenAdded: number;
      productNameWhenAdded: string;
      variantNameWhenAdded: string;
      variant: {
        id: string;
        name: string;
        priceAmountMinor: number;
        currency: string;
        stock: number;
        product: { id: string; name: string; shopId: string };
      };
    },
    unavailableReason: CartLineUnavailableReason | null,
    reserved: ReservedStock = new Map(),
  ): CartItemDto {
    const orderable = unavailableReason === null;
    const dto = new CartItemDto();
    dto.id = row.id;
    dto.variantId = row.variant.id;
    dto.quantity = row.quantity;
    dto.productId = row.variant.product.id;
    dto.productName = orderable ? row.variant.product.name : row.productNameWhenAdded;
    dto.variantName = orderable ? row.variant.name : row.variantNameWhenAdded;
    dto.shopId = row.variant.product.shopId;
    dto.priceAmountMinor = row.variant.priceAmountMinor;
    dto.priceAmountMinorWhenAdded = row.priceAmountMinorWhenAdded;
    dto.currency = row.variant.currency;
    dto.stock = availableStock({ id: row.variant.id, stock: row.variant.stock }, reserved);
    dto.orderable = orderable;
    dto.unavailableReason = unavailableReason;

    return dto;
  }
}

/**
 * The whole cart (K4: one per person). `orderCount` answers spec 5/12's "รู้ก่อนกดยืนยัน" —
 * checkout splits one order per shop (invariant 4), counted over only the **orderable** items,
 * since an item that can't become an order doesn't contribute one.
 */
export class CartDto {
  @ApiProperty({ type: [CartItemDto] })
  items!: CartItemDto[];

  @ApiProperty({ description: 'How many orders checking out right now would create — one per distinct shop among the orderable items.' })
  orderCount!: number;

  static from(items: CartItemDto[]): CartDto {
    const dto = new CartDto();
    dto.items = items;
    dto.orderCount = new Set(items.filter((item) => item.orderable).map((item) => item.shopId)).size;

    return dto;
  }
}
