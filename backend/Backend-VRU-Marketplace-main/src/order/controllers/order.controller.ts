import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequiresVerifiedEmail } from '../../auth/decorators/requires-verified-email.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../../common/pagination/page.dto.js';
import type { Page } from '../../common/pagination/page.js';
import { RefusesAdmins } from '../../community/decorators/refuses-admins.decorator.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { PaymentChannelDto } from '../../shop/dto/payment-channel.dto.js';
import { CancelOrderDto } from '../dto/cancel-order.dto.js';
import { CheckoutDto } from '../dto/checkout.dto.js';
import { ListOrdersQueryDto } from '../dto/list-orders-query.dto.js';
import { OrderDto } from '../dto/order.dto.js';
import { RefundAccountDto } from '../dto/refund-account.dto.js';
import { RejectShippingFeeDto } from '../dto/reject-shipping-fee.dto.js';
import { OrderService } from '../services/order.service.js';
import { RefundService } from '../services/refund.service.js';

/**
 * `Order` (#49). Checking out needs a verified email, same gate as adding to the cart (K4) —
 * placing an order is exactly the kind of thing that gate exists for. `GET :orderId` is the one
 * place both a buyer and a shop owner read the same order; `GET /shops/me/orders` (a separate
 * controller, `shop-order.controller.ts`) is the shop-side list, same split `PaymentChannelController`
 * already uses for "my shop's own thing" vs. a buyer-facing route.
 */
@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly refunds: RefundService,
  ) {}

  @Post()
  @RequiresVerifiedEmail()
  @RefusesAdmins()
  @ApiOperation({
    summary: 'Check out — splits the cart into one order per shop',
    description:
      'Only items the cart already marked `orderable` become orders (#42/#48); anything else ' +
      'stays in the cart. `totalAmount` is null on every order created here — the shop sets ' +
      'shipping afterward (#51, invariant 4).',
  })
  @ApiResponse({ status: 201, type: [OrderDto] })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Email not verified (K4), or the caller is a community admin / super admin — admin accounts never buy (§85, N29).' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such address, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Cart is empty, or nothing in it is orderable. STALE_VIEW (§111): the lines sent are not what the cart holds now — reload the cart.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async checkout(@CurrentUser() actor: CurrentUserType, @Body() dto: CheckoutDto): Promise<OrderDto[]> {
    return this.orders.checkout(actor.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My own orders, as a buyer' })
  @ApiPaginatedResponse(OrderDto)
  @ApiCookieAuth('access_token')
  async list(@CurrentUser() actor: CurrentUserType, @Query() query: ListOrdersQueryDto): Promise<Page<OrderDto>> {
    return this.orders.listForBuyer(actor.id, query.limit, query.cursor, query.status);
  }

  @Get(':orderId')
  @ApiOperation({
    summary: 'View one order',
    description: 'Viewable by the buyer who placed it, or the owner of the shop it was placed against — nobody else.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not the caller’s.' })
  @ApiCookieAuth('access_token')
  async getById(@CurrentUser() actor: CurrentUserType, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderDto> {
    return this.orders.getById(actor.id, orderId);
  }

  @Post(':orderId/reject-shipping-fee')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject the shipping fee the shop just set — cancels the order',
    description:
      'E2b: immediate, and releases the stock reservation (#50) for free — a reason is required. ' +
      'Only possible while the order is AWAITING_PAYMENT (a fee has been set but not yet paid).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not currently waiting on a shipping-fee decision.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async rejectShippingFee(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RejectShippingFeeDto,
  ): Promise<OrderDto> {
    return this.orders.rejectShippingFee(actor.id, orderId, dto);
  }

  @Get(':orderId/payment-channels')
  @ApiOperation({
    summary: 'The shop’s payment channels for this order',
    description:
      'L1: visible only to this order’s own buyer, and only while it is AWAITING_PAYMENT or ' +
      'PAYMENT_SUBMITTED — #36 deliberately built no public route for these.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: [PaymentChannelDto] })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'No such order, not mine, or the order isn’t in a status where this is shown.',
  })
  @ApiCookieAuth('access_token')
  async paymentChannels(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<PaymentChannelDto[]> {
    return this.orders.paymentChannelsFor(actor.id, orderId);
  }

  @Get(':orderId/payment-channels/:channelId/qr-image')
  @ApiOperation({
    summary: 'The QR image bytes for one of this order’s payment channels',
    description:
      'Code review of topic 4 (2026-09-22, §77): the list above could tell a buyer `hasQrImage: ' +
      'true` with no way to fetch the bytes — #36 only ever built the shop owner’s own read. ' +
      'Same gate as GET :orderId/payment-channels (same buyer, same order, same AWAITING_PAYMENT ' +
      '/ PAYMENT_SUBMITTED window).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiParam({ name: 'channelId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The image bytes, Content-Type set to image/jpeg or image/png.' })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description:
      'No such order, not mine, the order isn’t in a status where this is shown, no such channel ' +
      'on this order’s shop, or that channel has no QR image.',
  })
  @ApiCookieAuth('access_token')
  async paymentChannelQrImage(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.orders.paymentChannelQrImageFor(actor.id, orderId, channelId);
    // §87: a PromptPay QR carries a phone or national ID number — served like a slip, not like a logo.
    sendPrivateFile(response, image);
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel my own order — before any money has moved',
    description:
      'D4: no reason required (unlike the shop’s own cancel). Only possible while the order is ' +
      'AWAITING_SHIPPING_QUOTE or AWAITING_PAYMENT — once a slip is submitted (H5) neither side ' +
      'can cancel unilaterally anymore. Releases the stock reservation for free (#50).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'No longer cancellable — already resolved, or frozen.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async cancel(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderDto> {
    return this.orders.cancelAsBuyer(actor.id, orderId, dto);
  }

  @Post(':orderId/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark this order received — only the buyer themselves may ever call this',
    description:
      '#59 (D5): no auto-close exists anywhere in this system — an order left SHIPPED stays ' +
      'SHIPPED forever until the buyer clicks this. Not reachable by the shop, a community ' +
      'admin, or super admin (no route exists for any of them). Refused while the order is ' +
      'frozen (N3), even though its status is still SHIPPED underneath — unfreezing restores ' +
      'the ability to call this.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not SHIPPED yet, already received, or frozen.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async receive(@CurrentUser() actor: CurrentUserType, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderDto> {
    return this.orders.markReceived(actor.id, orderId);
  }

  @Post(':orderId/refund-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enter (or correct) the account this order’s refund should land in',
    description:
      '#65 (L9): only while the order is REFUND_ORDERED — never collected ahead of time, and ' +
      'wiped again the instant this order reaches REFUNDED. Locked the moment the shop uploads ' +
      'its first refund slip (the money may already be on its way to whatever was on file then).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not REFUND_ORDERED, frozen, or the shop already uploaded a slip.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async submitRefundAccount(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RefundAccountDto,
  ): Promise<OrderDto> {
    return this.refunds.submitAccount(actor.id, orderId, dto);
  }

  @Post(':orderId/refund-received')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm this order’s refund actually arrived — only the buyer themselves may ever call this',
    description:
      '#65 (H6): not reachable by the shop or by any admin (I6 — only the buyer actually knows ' +
      'whether the money arrived). Requires at least one refund slip to already exist. Left ' +
      'unconfirmed for 7 days after the shop’s first slip, a sweep closes this the same way (H7). ' +
      'Either path closes any dispute still open on this order.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not REFUND_ORDERED, frozen, or no refund slip uploaded yet.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async confirmRefundReceived(@CurrentUser() actor: CurrentUserType, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderDto> {
    return this.refunds.confirmReceived(actor.id, orderId);
  }
}
