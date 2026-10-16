import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { RefundSlipDto } from '../dto/refund-slip.dto.js';
import { RefundService } from '../services/refund.service.js';

/**
 * `RefundSlip` (#65, K11) — the read side, shared by both the order's buyer and its shop's owner,
 * the same split `PaymentSlipController` already uses for payment slips. The write side (upload)
 * is shop-only and lives on `ShopOrderController` instead, the same place every other shop-only
 * order action (`shipping-fee`, `confirm-payment`, `ship`) already lives.
 */
@ApiTags('orders')
@Controller('orders/:orderId/refund-slips')
export class RefundSlipController {
  constructor(private readonly refunds: RefundService) {}

  @Get()
  @ApiOperation({ summary: 'Every refund slip uploaded for this order, oldest first' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: [RefundSlipDto] })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiCookieAuth('access_token')
  async list(@CurrentUser() actor: CurrentUserType, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<RefundSlipDto[]> {
    return this.refunds.listSlips(actor.id, orderId);
  }

  @Get(':slipId/file')
  @ApiOperation({
    summary: 'The refund slip’s image or PDF bytes',
    description: 'I5: never reachable by a community admin — same restraint PaymentSlipController documents on its own equivalent route.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiParam({ name: 'slipId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The file bytes, Content-Type set to image/jpeg, image/png, or application/pdf.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, no such slip, or not mine.' })
  @ApiCookieAuth('access_token')
  async readFile(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('slipId', ParseUUIDPipe) slipId: string,
    @Res() response: Response,
  ): Promise<void> {
    sendPrivateFile(response, await this.refunds.readSlipFile(actor.id, orderId, slipId));
  }
}
