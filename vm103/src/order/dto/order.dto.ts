import { ApiProperty } from '@nestjs/swagger';
import type { OrderCancelledBy, OrderStatus, PaymentChannelType } from '@prisma/client';
import { disputeDeadline } from '../../dispute/common/dispute-deadline.js';
import { ReviewDto } from '../../review/dto/review.dto.js';
import { addDays, addHours } from '../../time/clock.js';
import { PAYMENT_CONFIRMATION_WINDOW_DAYS, PAYMENT_WINDOW_HOURS, SHIPPING_QUOTE_WINDOW_HOURS } from '../common/order-policy.js';
import { TrackingNumberChangeDto } from './tracking-number-change.dto.js';

/**
 * #56 (I2): the cap on how many times a shop may reject a slip for one order. Lives here (not a
 * bare literal in `OrderService`) because this DTO is what turns the raw count into
 * `slipRejectionsRemaining` — one source for the number both sides of the cap read.
 */
export const MAX_SLIP_REJECTIONS = 2;

export class OrderItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  variantId!: string;

  @ApiProperty({ description: 'Snapshotted at checkout (invariant 5) — never the product’s current name.' })
  productNameAtPurchase!: string;

  @ApiProperty({ description: 'Snapshotted at checkout — never the variant’s current name.' })
  variantNameAtPurchase!: string;

  @ApiProperty({ description: 'Satang, integer — the price at the moment this order was placed, never the current one.' })
  priceAtPurchase!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  quantity!: number;

  static from(row: {
    id: string;
    variantId: string;
    productNameAtPurchase: string;
    variantNameAtPurchase: string;
    priceAtPurchase: number;
    currency: string;
    quantity: number;
  }): OrderItemDto {
    const dto = new OrderItemDto();
    dto.id = row.id;
    dto.variantId = row.variantId;
    dto.productNameAtPurchase = row.productNameAtPurchase;
    dto.variantNameAtPurchase = row.variantNameAtPurchase;
    dto.priceAtPurchase = row.priceAtPurchase;
    dto.currency = row.currency;
    dto.quantity = row.quantity;

    return dto;
  }
}

/**
 * What `displayStatus` can be beyond a plain `OrderStatus`. `'DISPUTED'` (#63) takes priority
 * over `'FROZEN'` per J3's own "ซ้อนกันได้ และข้อพิพาทชนะ" — an order can be both frozen and
 * disputed at once (its own admin-judgment freeze and an unrelated open dispute), and the dispute
 * is what the user actually needs to act on, so it wins the display.
 */
export type DisplayOrderStatus = OrderStatus | 'FROZEN' | 'DISPUTED';

/**
 * An order as its buyer or its shop's owner sees it — the same shape for both (spec 7/12's AC
 * never asks for two different views, unlike a community admin's masked one, which is topic 10's
 * `#62`/`#64` to build, not this ticket's).
 */
export class OrderDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  buyerId!: string;

  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ description: 'The display name of the shop this order was placed against.' })
  shopName!: string;

  @ApiProperty({ enum: ['AWAITING_SHIPPING_QUOTE', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUND_ORDERED', 'REFUNDED'] })
  status!: OrderStatus;

  @ApiProperty({
    enum: ['AWAITING_SHIPPING_QUOTE', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUND_ORDERED', 'REFUNDED', 'FROZEN', 'DISPUTED'],
    description:
      'What the frontend should actually render (spec 7/12) — already folds in frozenAt and an ' +
      'open dispute (#63) so the client never has to know either rule itself. DISPUTED overrides ' +
      'everything else (J3); otherwise FROZEN overrides `status`.',
  })
  displayStatus!: DisplayOrderStatus;

  @ApiProperty({ nullable: true, description: 'Satang, integer. Null until the shop sets a shipping fee (#51) — invariant 4.' })
  totalAmountMinor!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Satang, integer. Null until the shop sets it — locked forever once set (H1), never editable afterward.',
  })
  shippingAmountMinor!: number | null;

  @ApiProperty({ description: 'Satang, integer. Discount amount applied by coupon.' })
  discountAmountMinor!: number;

  @ApiProperty({ format: 'uuid', nullable: true })
  couponId!: string | null;

  @ApiProperty({ nullable: true })
  couponCode!: string | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  recipientName!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  houseNumber!: string;

  @ApiProperty({ nullable: true })
  villageNumber!: string | null;

  @ApiProperty({ nullable: true })
  alley!: string | null;

  @ApiProperty({ nullable: true })
  road!: string | null;

  @ApiProperty()
  subdistrictName!: string;

  @ApiProperty()
  districtName!: string;

  @ApiProperty()
  provinceName!: string;

  @ApiProperty()
  postalCode!: string;

  @ApiProperty({
    enum: ['BUYER', 'SHOP', 'ADMIN'],
    nullable: true,
    description:
      '#52: who cancelled, if this order was cancelled by hand — `BUYER` also when the buyer ' +
      'rejected the shipping fee (E2b, §81). #62: `ADMIN` when a community admin (or super ' +
      'admin) terminated a frozen, unpaid order. Null for any other way an order reaches ' +
      'CANCELLED (the three-clock sweep’s own auto-cancels).',
  })
  cancelledBy!: OrderCancelledBy | null;

  @ApiProperty({
    nullable: true,
    description:
      '#52: the cancelling side’s stated reason — required from the shop (H11), optional from the ' +
      'buyer (D4), and the buyer’s required reason when they rejected the shipping fee (E2b, §81). ' +
      'Visible to the other party.',
  })
  cancelReason!: string | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description:
      '#53: the deadline of whichever clock is currently running (invariant 3), computed fresh ' +
      'every time — never a stored value. Null while frozen (H3 — the clock is paused, so there ' +
      'is no deadline to show) and null once the order leaves every clock-bearing status ' +
      '(PAID and beyond, or CANCELLED/REFUND_ORDERED/REFUNDED). Re-fetch after this passes — the ' +
      'sweep runs every 5 minutes, so the deadline reaching zero does not mean the status has ' +
      'changed yet.',
  })
  expiresAt!: Date | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description:
      '#55 (K8): the moment the shop clicked "confirm payment received" — never `paidAt`, ' +
      'because the platform never verifies a transfer itself (invariant 2). Null until then. ' +
      '`sellerConfirmedBy` (who clicked it) is not exposed here, same restraint as ' +
      '`PaymentSlip.rejectedByUserId` — an internal detail, not something a caller needs.',
  })
  sellerConfirmedAt!: Date | null;

  @ApiProperty({
    minimum: 0,
    maximum: MAX_SLIP_REJECTIONS,
    description: '#56 (I2): how many times the shop has rejected a slip for this order so far.',
  })
  slipRejectionCount!: number;

  @ApiProperty({
    minimum: 0,
    maximum: MAX_SLIP_REJECTIONS,
    description:
      `#56: ${MAX_SLIP_REJECTIONS} minus slipRejectionCount, clamped at 0 — computed here on ` +
      'purpose so the frontend never has to know the cap itself or subtract anything (AC: ' +
      '"ห้ามให้หน้าบ้านนับเอง"). 0 means the reject button must disappear.',
  })
  slipRejectionsRemaining!: number;

  @ApiProperty({ type: [OrderItemDto] })
  items!: OrderItemDto[];

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: '#58 (F1): set the moment the shop ships — never any other way. Two clocks outside the three-clock sweep (D5b, H10) start from this.',
  })
  shippedAt!: Date | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: '#58: null until the shop ships.' })
  shippingCarrierId!: string | null;

  @ApiProperty({ nullable: true, description: '#58: the carrier’s name, resolved so the frontend never has to look it up separately. §85: the name as it read when the order shipped — a later rename of the carrier does not change it.' })
  shippingCarrierName!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'K9: set only when shippingCarrierId names the "อื่นๆ" carrier — the shop’s own free-text name for it. No tracking link is ever built for this one (backend never stores a URL).',
  })
  carrierNameOther!: string | null;

  @ApiProperty({ nullable: true, description: '#58/I15: editable until the buyer marks the order received — see trackingNumberHistory for every prior value.' })
  trackingNumber!: string | null;

  @ApiProperty({ type: [TrackingNumberChangeDto], description: 'I15: every edit to trackingNumber after shipping, oldest first. Visible to the buyer, not just the shop.' })
  trackingNumberHistory!: TrackingNumberChangeDto[];

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: '#59 (D5): set only when the buyer clicks "ได้รับของแล้ว" themselves — nothing else ever sets this, and there is no auto-close.',
  })
  completedAt!: Date | null;

  @ApiProperty({
    type: ReviewDto,
    nullable: true,
    description: '#60: null until the buyer writes one (only possible once completedAt is set). Shows a community admin’s deletion here even though it is hidden from the public list.',
  })
  review!: ReviewDto | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description:
      '#63 (D5b): the deadline to open a dispute — the earlier of 15 days after shipping or 7 ' +
      'after being marked received, paused for however long the order has ever spent frozen ' +
      '(N3); for a CANCELLED order, 15 days after it was cancelled (§85). Null while there is no ' +
      'deadline yet (a live order that hasn’t shipped) — never null to mean "no limit". A REFUNDED ' +
      'order cannot be disputed at all (§85), whatever this says.',
  })
  disputeDeadline!: Date | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: '#65: the moment this order reached REFUND_ORDERED, whichever of the three paths got it there. Null until then.',
  })
  refundOrderedAt!: Date | null;

  @ApiProperty({
    enum: ['BANK_TRANSFER', 'PROMPTPAY'],
    nullable: true,
    description: '#65 (L9): the buyer’s own receiving account for this refund — null except during the REFUND_ORDERED phase.',
  })
  refundAccountType!: PaymentChannelType | null;

  @ApiProperty({ nullable: true, description: '#65: set only when refundAccountType is BANK_TRANSFER.' })
  refundBankName!: string | null;

  @ApiProperty({ nullable: true, description: '#65: set only when refundAccountType is BANK_TRANSFER.' })
  refundBankAccountNumber!: string | null;

  @ApiProperty({ nullable: true, description: '#65: set only when refundAccountType is BANK_TRANSFER.' })
  refundBankAccountName!: string | null;

  @ApiProperty({ nullable: true, description: '#65: set only when refundAccountType is PROMPTPAY.' })
  refundPromptPayId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static from(row: {
    id: string;
    buyerId: string;
    shopId: string;
    status: OrderStatus;
    frozenAt: Date | null;
    totalAmountMinor: number | null;
    shippingAmountMinor: number | null;
    discountAmountMinor?: number | null;
    couponId?: string | null;
    couponCode?: string | null;
    shippingQuoteWindowStartedAt: Date | null;
    paymentWindowStartedAt: Date | null;
    paymentConfirmationWindowStartedAt: Date | null;
    sellerConfirmedAt: Date | null;
    _count: { paymentSlips: number };
    cancelledBy: OrderCancelledBy | null;
    cancelReason: string | null;
    currency: string;
    recipientName: string;
    phone: string;
    houseNumber: string;
    villageNumber: string | null;
    alley: string | null;
    road: string | null;
    subdistrictName: string;
    districtName: string;
    provinceName: string;
    postalCode: string;
    items: Parameters<typeof OrderItemDto.from>[0][];
    shippedAt: Date | null;
    shippingCarrierId: string | null;
    shippingCarrier: { name: string } | null;
    shippingCarrierNameAtShipment: string | null;
    carrierNameOther: string | null;
    trackingNumber: string | null;
    trackingNumberChanges: Parameters<typeof TrackingNumberChangeDto.from>[0][];
    completedAt: Date | null;
    cancelledAt: Date | null;
    review: Parameters<typeof ReviewDto.from>[0] | null;
    frozenDurationSeconds: number;
    disputes: { id: string }[];
    refundOrderedAt: Date | null;
    refundAccountType: PaymentChannelType | null;
    refundBankName: string | null;
    refundBankAccountNumber: string | null;
    refundBankAccountName: string | null;
    refundPromptPayId: string | null;
    shop?: { name: string } | null;
    createdAt: Date;
    updatedAt: Date;
  }): OrderDto {
    const dto = new OrderDto();
    dto.id = row.id;
    dto.buyerId = row.buyerId;
    dto.shopId = row.shopId;
    dto.shopName = (row as { shop?: { name: string } | null }).shop?.name ?? '';
    dto.status = row.status;
    dto.displayStatus = row.disputes.length > 0 ? 'DISPUTED' : row.frozenAt !== null ? 'FROZEN' : row.status;
    dto.totalAmountMinor = row.totalAmountMinor;
    dto.shippingAmountMinor = row.shippingAmountMinor;
    dto.discountAmountMinor = row.discountAmountMinor ?? 0;
    dto.couponId = row.couponId ?? null;
    dto.couponCode = row.couponCode ?? null;
    dto.sellerConfirmedAt = row.sellerConfirmedAt;
    dto.slipRejectionCount = row._count.paymentSlips;
    dto.slipRejectionsRemaining = Math.max(0, MAX_SLIP_REJECTIONS - row._count.paymentSlips);
    dto.cancelledBy = row.cancelledBy;
    dto.cancelReason = row.cancelReason;
    dto.expiresAt = computeExpiresAt(row);
    dto.currency = row.currency;
    dto.recipientName = row.recipientName;
    dto.phone = row.phone;
    dto.houseNumber = row.houseNumber;
    dto.villageNumber = row.villageNumber;
    dto.alley = row.alley;
    dto.road = row.road;
    dto.subdistrictName = row.subdistrictName;
    dto.districtName = row.districtName;
    dto.provinceName = row.provinceName;
    dto.postalCode = row.postalCode;
    dto.items = row.items.map((item) => OrderItemDto.from(item));
    dto.shippedAt = row.shippedAt;
    dto.shippingCarrierId = row.shippingCarrierId;
    // §85: the name kept at shipping time wins; the live row's name is only a fallback for an
    // order that somehow has a carrier but no kept name.
    dto.shippingCarrierName = row.shippingCarrierNameAtShipment ?? row.shippingCarrier?.name ?? null;
    dto.carrierNameOther = row.carrierNameOther;
    dto.trackingNumber = row.trackingNumber;
    dto.trackingNumberHistory = row.trackingNumberChanges.map((change) => TrackingNumberChangeDto.from(change));
    dto.completedAt = row.completedAt;
    dto.review = row.review === null ? null : ReviewDto.from(row.review);
    dto.disputeDeadline = disputeDeadline(row);
    dto.refundOrderedAt = row.refundOrderedAt;
    dto.refundAccountType = row.refundAccountType;
    dto.refundBankName = row.refundBankName;
    dto.refundBankAccountNumber = row.refundBankAccountNumber;
    dto.refundBankAccountName = row.refundBankAccountName;
    dto.refundPromptPayId = row.refundPromptPayId;
    dto.createdAt = row.createdAt;
    dto.updatedAt = row.updatedAt;

    return dto;
  }
}

/**
 * #53: the deadline of whichever clock is currently running, re-derived from the relevant
 * stored instant every time this DTO is built — never a value read back out of a column, and
 * never computed once at checkout (invariant 3 forbids both). Reads the same window lengths
 * (`order-policy.ts`) and the same start columns `order-sweep.tasks.ts` does, so the countdown a
 * buyer or shop sees cannot disagree with when the sweep actually acts.
 *
 * §81: a null start column means null here for every clock, clock 1 included. This used to fall
 * back to `createdAt` for clock 1, which the sweep never does — a row like that would have shown
 * a deadline nothing was ever going to enforce. (#61's migration backfilled every row, so in
 * practice the column is never null; this only keeps the two sides from telling different stories.)
 */
function computeExpiresAt(row: {
  status: OrderStatus;
  frozenAt: Date | null;
  shippingQuoteWindowStartedAt: Date | null;
  paymentWindowStartedAt: Date | null;
  paymentConfirmationWindowStartedAt: Date | null;
}): Date | null {
  if (row.frozenAt !== null) {
    return null;
  }

  switch (row.status) {
    case 'AWAITING_SHIPPING_QUOTE':
      return row.shippingQuoteWindowStartedAt === null
        ? null
        : addHours(row.shippingQuoteWindowStartedAt, SHIPPING_QUOTE_WINDOW_HOURS);
    case 'AWAITING_PAYMENT':
      return row.paymentWindowStartedAt === null ? null : addHours(row.paymentWindowStartedAt, PAYMENT_WINDOW_HOURS);
    case 'PAYMENT_SUBMITTED':
      return row.paymentConfirmationWindowStartedAt === null
        ? null
        : addDays(row.paymentConfirmationWindowStartedAt, PAYMENT_CONFIRMATION_WINDOW_DAYS);
    default:
      return null;
  }
}
