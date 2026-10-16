import { ApiProperty } from '@nestjs/swagger';
import { DashboardRangeDto, SalesDto } from './sales.dto.js';

/**
 * Waiting on the shop right now — each the length of `GET /shops/me/orders?status=…` for that step
 * (the refund steps split one status by what the buyer has done). Frozen orders are included: the
 * shop keeps working them (J2).
 */
export class ShopTodoDto {
  @ApiProperty({ description: 'AWAITING_SHIPPING_QUOTE — set the shipping fee.' })
  awaitingShippingQuote!: number;

  @ApiProperty({ description: 'PAYMENT_SUBMITTED — check the slip and confirm the money arrived.' })
  awaitingPaymentConfirmation!: number;

  @ApiProperty({ description: 'PAID — ship.' })
  awaitingShipment!: number;

  @ApiProperty({ description: 'REFUND_ORDERED, buyer gave their account — upload the refund slip.' })
  awaitingRefundSlip!: number;

  @ApiProperty({ description: 'Open disputes the shop has not answered and nobody has ruled on.' })
  disputesAwaitingResponse!: number;
}

export class ShopWaitingDto {
  @ApiProperty({ description: 'AWAITING_PAYMENT — the buyer has not transferred yet.' })
  awaitingBuyerPayment!: number;

  @ApiProperty({ description: 'SHIPPED — the buyer has not confirmed receipt.' })
  shippedAwaitingReceipt!: number;

  @ApiProperty({ description: 'REFUND_ORDERED, the buyer has not given an account yet.' })
  awaitingRefundAccount!: number;

  @ApiProperty({ description: 'REFUND_ORDERED, slip uploaded — the buyer has not confirmed the refund.' })
  awaitingRefundReceipt!: number;

  @ApiProperty({ description: 'Frozen, waiting for an admin. Also counted under their status — for a warning badge.' })
  frozen!: number;
}

/** The current shop's products, not deleted. The four statuses do not overlap. */
export class ShopCatalogDto {
  @ApiProperty({ description: 'Approved and published.' })
  live!: number;

  @ApiProperty({ description: 'Waiting for review.' })
  pendingReview!: number;

  @ApiProperty()
  rejected!: number;

  @ApiProperty({ description: 'Approved, hidden by the shop.' })
  hiddenByShop!: number;

  @ApiProperty({ description: 'Variants of live products with nothing left to order once reservations are taken out.' })
  soldOutVariants!: number;
}

export class ShopRatingDto {
  @ApiProperty({ nullable: true, description: 'The same figure the storefront shows — null with no reviews.' })
  averageRating!: number | null;

  @ApiProperty()
  reviewCount!: number;
}

/** §127: GET /shops/me/dashboard — the caller's own shop. */
export class ShopDashboardDto {
  @ApiProperty({ type: DashboardRangeDto })
  range!: DashboardRangeDto;

  @ApiProperty({ format: 'uuid', description: 'The shop GET /shops/me returns.' })
  shopId!: string;

  @ApiProperty({ type: ShopTodoDto })
  todo!: ShopTodoDto;

  @ApiProperty({ type: ShopWaitingDto })
  waiting!: ShopWaitingDto;

  @ApiProperty({ type: ShopCatalogDto })
  catalog!: ShopCatalogDto;

  @ApiProperty({ type: SalesDto })
  sales!: SalesDto;

  @ApiProperty({ type: ShopRatingDto })
  rating!: ShopRatingDto;
}
