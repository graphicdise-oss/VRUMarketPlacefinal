import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../../common/pagination/page.dto.js';
import type { Page } from '../../common/pagination/page.js';
import { AcceptsUpload } from '../../files/accepts-upload.decorator.js';
import { CancelOrderAsShopDto } from '../dto/cancel-order-as-shop.dto.js';
import { ListOrdersQueryDto } from '../dto/list-orders-query.dto.js';
import { OrderDto } from '../dto/order.dto.js';
import { RefundSlipDto } from '../dto/refund-slip.dto.js';
import { RejectPaymentSlipDto } from '../dto/reject-payment-slip.dto.js';
import { SetShippingFeeDto } from '../dto/set-shipping-fee.dto.js';
import { ShipOrderDto } from '../dto/ship-order.dto.js';
import { ShippingSlipDto } from '../dto/shipping-slip.dto.js';
import { UpdateTrackingNumberDto } from '../dto/update-tracking-number.dto.js';
import { OrderService } from '../services/order.service.js';
import { RefundService } from '../services/refund.service.js';
import { ShippingService } from '../services/shipping.service.js';

/**
 * The shop-owner side of #49 — same split `PaymentChannelController` already uses at
 * `/shops/me/payment-channels`: no `:shopId` in the path because 1 คน = 1 ร้าน (B2), so
 * `/shops/me/orders` always means the caller's own shop. A single order's detail view is shared
 * with the buyer side at `GET /orders/:orderId`, not duplicated here.
 */
@ApiTags('orders')
@Controller('shops/me/orders')
export class ShopOrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly shipping: ShippingService,
    private readonly refunds: RefundService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My shop’s orders, across every buyer' })
  @ApiPaginatedResponse(OrderDto)
  @ApiCookieAuth('access_token')
  async list(@CurrentUser() actor: CurrentUserType, @Query() query: ListOrdersQueryDto): Promise<Page<OrderDto>> {
    return this.orders.listForShop(actor.id, query.limit, query.cursor, query.status);
  }

  @Post(':orderId/shipping-fee')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set this order’s shipping fee — once, ever',
    description:
      '🚨 H1: locked the instant it is set. A second call always fails with 409, even to change ' +
      'a typo — the frontend must show a confirmation before this call, not after. A suspended ' +
      'shop may still call this (J2 — suspension blocks new sales, not finishing orders already placed).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not this shop’s.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already set — locked, cannot be changed.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async setShippingFee(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: SetShippingFeeDto,
  ): Promise<OrderDto> {
    return this.orders.setShippingFee(actor.id, orderId, dto);
  }

  @Post(':orderId/confirm-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the transfer arrived — cuts real stock, the only place in the system that does',
    description:
      'K8: rejects the whole confirmation if any item’s stock is now insufficient, with a ' +
      'message naming which one — the order stays PAYMENT_SUBMITTED, clock 3 keeps running, and ' +
      'stock never goes negative. Idempotent — a second call always 409s, never cuts stock ' +
      'twice. A suspended shop may still call this (J2 — finishing an already-placed sale is not ' +
      'a right suspension takes away).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not this shop’s.' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'Not awaiting confirmation (already confirmed, or no slip submitted yet), or a variant’s stock is now insufficient.',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async confirmPayment(@CurrentUser() actor: CurrentUserType, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderDto> {
    return this.orders.confirmPayment(actor.id, orderId);
  }

  @Post(':orderId/payment-slips/:slipId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject one of this order’s uploaded slips — wrong amount, wrong account, unreadable',
    description:
      'I2: a reason is required, and the buyer sees it — this is not a cancellation, both sides ' +
      'still want the sale to go through. Sends the order back to AWAITING_PAYMENT with a fresh ' +
      '24h window (never the time that was left) and resets clock 2’s warning flag. Capped at 2 ' +
      'rejections per order (a shop could otherwise dodge REFUND_ORDERED forever) — ' +
      'slipRejectionsRemaining on the response says how many are left; 0 means this button must ' +
      'disappear. A suspended shop, or a frozen order, may still call this (J2/invariant 7 — same ' +
      'reasoning as confirm-payment: this keeps the deal moving, it doesn’t end it).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiParam({ name: 'slipId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order/slip, not this shop’s, or the slip is already rejected.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not awaiting a slip decision, or already at the 2-rejection cap.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async rejectSlip(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('slipId', ParseUUIDPipe) slipId: string,
    @Body() dto: RejectPaymentSlipDto,
  ): Promise<OrderDto> {
    return this.orders.rejectSlip(actor.id, orderId, slipId, dto);
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel this order — before any money has moved',
    description:
      'H11: a reason is required — missing or empty is rejected. Also the only way out of a ' +
      'shipping fee entered wrong (H1 forbids editing it). Only possible while the order is ' +
      'AWAITING_SHIPPING_QUOTE or AWAITING_PAYMENT; once a slip is submitted (H5) neither side ' +
      'can cancel unilaterally anymore. Releases the stock reservation for free (#50).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not this shop’s.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'No longer cancellable — already resolved, or frozen.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async cancel(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelOrderAsShopDto,
  ): Promise<OrderDto> {
    return this.orders.cancelAsShop(actor.id, orderId, dto);
  }

  @Post(':orderId/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ship this order — picks a courier from the list and records a tracking number',
    description:
      '#58 (F1/K9): only reachable from PAID. shippingCarrierId must be an active ' +
      'ShippingCarrier row — carrierNameOther is required if, and only if, that row is the ' +
      '"อื่นๆ" catch-all. trackingNumber is mandatory in every case. A suspended shop, or a ' +
      'frozen order, may still call this (J2/invariant 7 — finishing an already-paid sale is not ' +
      'a right either one takes away).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'No such carrier, or carrierNameOther is missing/not allowed for the carrier chosen.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not this shop’s.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not PAID — not paid yet, or already shipped.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async ship(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: ShipOrderDto,
  ): Promise<OrderDto> {
    return this.shipping.ship(actor.id, orderId, dto);
  }

  @Patch(':orderId/tracking-number')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Correct the tracking number of an order already shipped',
    description:
      '#58 (I15): every edit is kept, never overwritten silently — see ' +
      'OrderDto.trackingNumberHistory, visible to the buyer too. Only possible while the order is ' +
      'SHIPPED; once the buyer marks it received this always 409s (evidence on a closed order ' +
      'stays put). A suspended shop, or a frozen order, may still call this (J2).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not this shop’s.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not SHIPPED — not shipped yet, or already received.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async updateTrackingNumber(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateTrackingNumberDto,
  ): Promise<OrderDto> {
    return this.shipping.updateTrackingNumber(actor.id, orderId, dto);
  }

  @Post(':orderId/refund-slips')
  @HttpCode(HttpStatus.CREATED)
  @AcceptsUpload({ field: 'file', check: (s, userId, p) => s.get(RefundService, { strict: false }).requireAwaitingRefund(userId, p.orderId!) })
  @ApiOperation({
    summary: 'Upload proof this order’s refund was sent back to the buyer',
    description:
      '#65 (K11): jpg/png/pdf only, 1 file per call, up to 10MB — same ceiling as a payment slip ' +
      '(#36). Only while REFUND_ORDERED. Not blocked by a suspended shop or a frozen order (J2/' +
      'invariant 7) — a shop still owes this refund regardless of either. The first slip on an ' +
      'order starts the buyer’s own 7-day confirm-or-auto-close window (H7); every slip after ' +
      'that just adds another row.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 201, type: RefundSlipDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not a real jpg/png/pdf, or no file sent.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not this shop’s.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not REFUND_ORDERED.' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'File too large.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async uploadRefundSlip(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<RefundSlipDto> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.refunds.uploadSlip(actor.id, orderId, file);
  }

  @Post(':orderId/shipping-slips')
  @HttpCode(HttpStatus.CREATED)
  @AcceptsUpload({ field: 'file', check: (s, userId, p) => s.get(ShippingService, { strict: false }).requireShippableOrShipped(userId, p.orderId!) })
  @ApiOperation({
    summary: 'Upload shipping receipt / postal slip proving the order was dispatched',
    description: 'jpg/png/pdf only, 1 file per call, up to 10MB. Allowed in PAID or SHIPPED status.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ShippingSlipDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not a real jpg/png/pdf, or no file sent.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not this shop’s.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not PAID or SHIPPED.' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'File too large.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async uploadShippingSlip(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ShippingSlipDto> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.shipping.uploadSlip(actor.id, orderId, file);
  }
}

