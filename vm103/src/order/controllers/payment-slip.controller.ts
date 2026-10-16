import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Res, UploadedFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { AcceptsUpload } from '../../files/accepts-upload.decorator.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { PaymentSlipDto } from '../dto/payment-slip.dto.js';
import { PaymentSlipService } from '../services/payment-slip.service.js';

/**
 * `PaymentSlip` (#54, E1). Nested under the order it belongs to, not its own top-level resource
 * — a slip has no meaning outside the order that owns it, the same reasoning
 * `ShopOrderController` already uses for `shops/me/orders`. Every route here is reachable by
 * *both* the order's buyer and its shop's owner (`PaymentSlipService` enforces that split, not
 * this controller) except the upload itself, which is the buyer's alone (E1's "รับสลิปในหน้า
 * ออเดอร์เท่านั้น" is a buyer action; a shop cannot manufacture its own evidence).
 */
@ApiTags('orders')
@Controller('orders/:orderId/payment-slips')
export class PaymentSlipController {
  constructor(private readonly slips: PaymentSlipService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AcceptsUpload({ field: 'file', check: (s, userId, p) => s.get(PaymentSlipService, { strict: false }).requireSlipUploadable(userId, p.orderId!) })
  @ApiOperation({
    summary: 'Upload a payment slip for this order',
    description:
      'jpg/png/pdf only, re-encoded or metadata-stripped (K1) · 1 file per call, up to 10MB · ' +
      'the first slip on an order moves it to PAYMENT_SUBMITTED; every slip after that just adds ' +
      'another row (I3) — re-uploading never resets clock 2 or clock 3.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 201, type: PaymentSlipDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not a real jpg/png/pdf, or no file sent.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine as a buyer.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Order isn’t waiting on a transfer anymore, or is frozen.' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'File too large.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async upload(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<PaymentSlipDto> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.slips.upload(actor.id, orderId, file);
  }

  @Get()
  @ApiOperation({ summary: 'Every slip uploaded for this order, oldest first' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: [PaymentSlipDto] })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiCookieAuth('access_token')
  async list(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<PaymentSlipDto[]> {
    return this.slips.list(actor.id, orderId);
  }

  @Get(':slipId/file')
  @ApiOperation({
    summary: 'The slip’s image or PDF bytes',
    description: 'I5: never reachable by a community admin, frozen order or not — break-glass has exactly one door (the dispute path, topic 10), not this one.',
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
    const file = await this.slips.readFile(actor.id, orderId, slipId);
    sendPrivateFile(response, file);
  }
}
