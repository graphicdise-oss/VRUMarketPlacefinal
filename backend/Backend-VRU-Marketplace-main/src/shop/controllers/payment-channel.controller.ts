import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { AcceptsUpload } from '../../files/accepts-upload.decorator.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { CreatePaymentChannelDto } from '../dto/create-payment-channel.dto.js';
import { PaymentChannelDto } from '../dto/payment-channel.dto.js';
import { UpdatePaymentChannelDto } from '../dto/update-payment-channel.dto.js';
import { PaymentChannelService } from '../services/payment-channel.service.js';

/**
 * A shop owner's own payment channels (#36 · K5). `shops/me/...` rather than
 * `shops/:shopId/...`: B2's "1 คน = 1 ร้าน ทั้งระบบ" makes "my shop" unambiguous, the same
 * reasoning `GET /shops/me` already uses — there is no id for a caller to get wrong.
 *
 * Every route here is the owner reading or writing their own data. There is deliberately no
 * public or buyer-facing route in this file — L1 opens a conditional, order-scoped view in
 * topic 7, once a real order exists to gate it on; this ticket is `#36 ห้ามมี endpoint สาธารณะ
 * ที่คืน paymentChannels` taken literally.
 */
@ApiTags('shops')
@Controller('shops/me/payment-channels')
export class PaymentChannelController {
  constructor(private readonly channels: PaymentChannelService) {}

  @Post()
  @ApiOperation({
    summary: 'Add a payment channel to my shop',
    description: 'K5 — a bank account or a PromptPay id, entered verbatim. Nothing here is validated ' +
      'against a real bank or PromptPay format.',
  })
  @ApiResponse({ status: 201, type: PaymentChannelDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Caller has no shop.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async create(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreatePaymentChannelDto,
  ): Promise<PaymentChannelDto> {
    return this.channels.create(actor.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my shop’s payment channels' })
  @ApiResponse({ status: 200, type: [PaymentChannelDto] })
  @ApiCookieAuth('access_token')
  async list(@CurrentUser() actor: CurrentUserType): Promise<PaymentChannelDto[]> {
    return this.channels.list(actor.id);
  }

  @Patch(':channelId')
  @ApiOperation({ summary: 'Edit one of my payment channels', description: 'Full replace, same shape as creation.' })
  @ApiParam({ name: 'channelId', format: 'uuid' })
  @ApiResponse({ status: 200, type: PaymentChannelDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such channel, or not mine.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async update(
    @CurrentUser() actor: CurrentUserType,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: UpdatePaymentChannelDto,
  ): Promise<PaymentChannelDto> {
    return this.channels.update(actor.id, channelId, dto);
  }

  @Delete(':channelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of my payment channels' })
  @ApiParam({ name: 'channelId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such channel, or not mine.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async remove(
    @CurrentUser() actor: CurrentUserType,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<void> {
    await this.channels.remove(actor.id, channelId);
  }

  @Post(':channelId/qr-image')
  @HttpCode(HttpStatus.OK)
  @AcceptsUpload({ field: 'file', check: (s, userId, p) => s.get(PaymentChannelService, { strict: false }).requireOwned(userId, p.channelId!) })
  @ApiOperation({
    summary: 'Upload (or replace) this channel’s QR code photo',
    description:
      'jpg/png only, re-encoded to strip EXIF (a phone photo carries GPS coordinates — K1). ' +
      'The system never generates a QR — this is a photo of one the shop already has.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'channelId', format: 'uuid' })
  @ApiResponse({ status: 200, type: PaymentChannelDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not a real jpg/png, or no file sent.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such channel, or not mine.' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'File too large.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async setQrImage(
    @CurrentUser() actor: CurrentUserType,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<PaymentChannelDto> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.channels.setQrImage(actor.id, channelId, file);
  }

  @Get(':channelId/qr-image')
  @ApiOperation({ summary: 'Fetch this channel’s QR code photo' })
  @ApiParam({ name: 'channelId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The image bytes, Content-Type set to image/jpeg or image/png.' })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'No such channel, not mine, or the channel has no QR image.',
  })
  @ApiCookieAuth('access_token')
  async readQrImage(
    @CurrentUser() actor: CurrentUserType,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.channels.readQrImage(actor.id, channelId);
    // §87: a PromptPay QR carries a phone or national ID number — served like a slip, not like a logo.
    sendPrivateFile(response, image);
  }
}
