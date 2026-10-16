import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UploadedFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AppException } from '../common/errors/app-exception.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { AcceptsUpload } from '../files/accepts-upload.decorator.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewDto } from './dto/review.dto.js';
import { ReviewService } from './review.service.js';

/**
 * `Review` (#60, F2): nested under the order it's about, the same reasoning
 * `PaymentSlipController` already uses — a review has no meaning outside the order that earned it.
 * Every route here is the buyer's own, and only the buyer's — `ReviewService` enforces that by
 * scoping every query to `{ orderId, buyerId }`, never `orderId` alone.
 */
@ApiTags('reviews')
@Controller('orders/:orderId/review')
export class OrderReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post()
  @ApiOperation({
    summary: 'Write a review for this order',
    description:
      'F2: only after the order has been marked received (#59) — not gated on any dispute ' +
      'state (I18c), and not time-limited on how late it can be written (I18b). One per order.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ReviewDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not received yet, or already reviewed.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async create(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.create(actor.id, orderId, dto);
  }

  @Patch()
  @ApiOperation({
    summary: 'Edit my review — only within the edit window',
    description: 'I18: editable for 7 days counted from when it was written, not from when the order was received.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReviewDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such review, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Edit window has passed, or the review was deleted.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async update(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.update(actor.id, orderId, dto);
  }

  @Post('images')
  @HttpCode(HttpStatus.OK)
  @AcceptsUpload({ field: 'file', check: (s, userId, p) => s.get(ReviewService, { strict: false }).requireImageSlot(userId, p.orderId!) })
  @ApiOperation({
    summary: 'Add a photo to my review',
    description: 'jpg/png only, re-encoded to strip EXIF, up to 5 (K10) — same edit window as PATCH.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReviewDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not a real jpg/png, or no file sent.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such review, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already at 5 images, edit window passed, or the review was deleted.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async addImage(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ReviewDto> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.reviews.addImage(actor.id, orderId, file);
  }

  @Delete('images/:imageId')
  @ApiOperation({
    summary: 'Remove a photo from my review',
    description: '§111: same edit window as PATCH. The file is deleted at once and its link stops working.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiParam({ name: 'imageId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReviewDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such review or photo, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Edit window has passed, or the review was deleted.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async removeImage(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<ReviewDto> {
    return this.reviews.removeImage(actor.id, orderId, imageId);
  }
}
