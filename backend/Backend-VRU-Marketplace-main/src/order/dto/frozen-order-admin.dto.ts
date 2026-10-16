import { ApiProperty } from '@nestjs/swagger';
import type { FreezeReason, OrderStatus } from '@prisma/client';

export class FrozenOrderAdminItemDto {
  @ApiProperty()
  productNameAtPurchase!: string;

  @ApiProperty()
  variantNameAtPurchase!: string;

  @ApiProperty({ description: 'Satang, integer.' })
  priceAtPurchase!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  quantity!: number;

  static from(row: {
    productNameAtPurchase: string;
    variantNameAtPurchase: string;
    priceAtPurchase: number;
    currency: string;
    quantity: number;
  }): FrozenOrderAdminItemDto {
    const dto = new FrozenOrderAdminItemDto();
    dto.productNameAtPurchase = row.productNameAtPurchase;
    dto.variantNameAtPurchase = row.variantNameAtPurchase;
    dto.priceAtPurchase = row.priceAtPurchase;
    dto.currency = row.currency;
    dto.quantity = row.quantity;

    return dto;
  }
}

/**
 * #62 (I5): what a community admin (or super admin) may see about a frozen order **outside a
 * dispute** — items, amounts, status, timestamps, and whether a slip exists at all. 🚨
 * Deliberately has no `recipientName`, `phone`, any address field, and no way to open a slip
 * file — those exist only through #64's break-glass route once `Dispute.status === OPEN`, and
 * this DTO must never grow one of those fields as a shortcut. The question this view answers is
 * "release or terminate", which needs none of that.
 */
export class FrozenOrderAdminDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty()
  status!: OrderStatus;

  @ApiProperty({ format: 'date-time', nullable: true })
  frozenAt!: Date | null;

  @ApiProperty({ enum: ['SELLER_BANNED', 'SHOP_SUSPENDED', 'BUYER_BANNED', 'PRODUCT_PROHIBITED'], isArray: true })
  freezeReasons!: FreezeReason[];

  @ApiProperty({ nullable: true, description: 'Satang, integer. Null until the shop set a shipping fee.' })
  totalAmountMinor!: number | null;

  @ApiProperty({ nullable: true, description: 'Satang, integer.' })
  shippingAmountMinor!: number | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: [FrozenOrderAdminItemDto] })
  items!: FrozenOrderAdminItemDto[];

  @ApiProperty({ description: 'Whether at least one payment slip has been uploaded — never the file itself.' })
  hasPaymentSlip!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static from(row: {
    id: string;
    shopId: string;
    status: OrderStatus;
    frozenAt: Date | null;
    totalAmountMinor: number | null;
    shippingAmountMinor: number | null;
    currency: string;
    items: Parameters<typeof FrozenOrderAdminItemDto.from>[0][];
    freezeReasons: { reason: FreezeReason }[];
    _count: { paymentSlips: number };
    createdAt: Date;
    updatedAt: Date;
  }): FrozenOrderAdminDto {
    const dto = new FrozenOrderAdminDto();
    dto.id = row.id;
    dto.shopId = row.shopId;
    dto.status = row.status;
    dto.frozenAt = row.frozenAt;
    dto.freezeReasons = row.freezeReasons.map((r) => r.reason);
    dto.totalAmountMinor = row.totalAmountMinor;
    dto.shippingAmountMinor = row.shippingAmountMinor;
    dto.currency = row.currency;
    dto.items = row.items.map((item) => FrozenOrderAdminItemDto.from(item));
    dto.hasPaymentSlip = row._count.paymentSlips > 0;
    dto.createdAt = row.createdAt;
    dto.updatedAt = row.updatedAt;

    return dto;
  }
}

/**
 * §102: one row of an admin's frozen-order queue — the same masked shape (nothing here that
 * `FrozenOrderAdminDto` does not already allow), plus which community it belongs to and, when a
 * dispute on it is still waiting for its ruling, that dispute: J3 has the dispute decide such an
 * order, and the freeze route refuses to, so the admin needs to know where to go instead.
 */
export class FrozenOrderQueueItemDto extends FrozenOrderAdminDto {
  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'A dispute on this order still waiting for its ruling, if any — rule on that instead (J3); ' +
      'POST /orders/:id/freeze-ruling answers 409 until it is ruled. A dispute already ruled (a ' +
      'BUYER_WINS one stays open through the refund loop) does not count: rule on the freeze.',
  })
  disputeAwaitingRulingId!: string | null;

  static fromQueueRow(
    row: Parameters<typeof FrozenOrderAdminDto.from>[0] & { shop: { communityId: string }; disputes: { id: string }[] },
  ): FrozenOrderQueueItemDto {
    const dto = Object.assign(new FrozenOrderQueueItemDto(), FrozenOrderAdminDto.from(row));
    dto.communityId = row.shop.communityId;
    dto.disputeAwaitingRulingId = row.disputes[0]?.id ?? null;

    return dto;
  }
}
