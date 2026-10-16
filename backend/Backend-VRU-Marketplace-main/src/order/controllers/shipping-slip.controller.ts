import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { ShippingSlipDto } from '../dto/shipping-slip.dto.js';
import { ShippingService } from '../services/shipping.service.js';

/**
 * `ShippingSlip` — postal receipt or courier dispatch slip uploaded by the shop.
 * Read side shared by both the order's buyer and its shop's owner.
 */
@ApiTags('orders')
@Controller('orders/:orderId/shipping-slips')
export class ShippingSlipController {
  constructor(private readonly shipping: ShippingService) {}

  @Get()
  @ApiOperation({ summary: 'Every shipping slip uploaded for this order, oldest first' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: [ShippingSlipDto] })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiCookieAuth('access_token')
  async list(@CurrentUser() actor: CurrentUserType, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<ShippingSlipDto[]> {
    return this.shipping.listSlips(actor.id, orderId);
  }

  @Get(':slipId/file')
  @ApiOperation({
    summary: 'The shipping slip’s image or PDF bytes',
    description: 'Shared between the buyer and shop owner to verify physical proof of dispatch.',
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
    sendPrivateFile(response, await this.shipping.readSlipFile(actor.id, orderId, slipId));
  }
}
