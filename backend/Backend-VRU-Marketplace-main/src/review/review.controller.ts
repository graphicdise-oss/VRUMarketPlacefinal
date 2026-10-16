import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { RequiresCommunityAdmin } from '../community/decorators/requires-community-admin.decorator.js';
import { DeleteReviewDto } from './dto/delete-review.dto.js';
import { ReviewDto } from './dto/review.dto.js';
import { ReviewIdScopeResolver } from './review-id.scope-resolver.js';
import { ReviewService } from './review.service.js';

/**
 * The two actions that key off a review's own id directly, rather than the order it belongs to:
 * reading one of its photos (public, the same restraint `ProductController`'s image route uses),
 * and a community admin removing it (L3) — invariant 1's sixth and last power a community admin
 * has, gated by the same two-tier guard (#32) every other admin action in this project uses.
 */
@ApiTags('reviews')
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get(':reviewId/images/:imageId')
  @Public()
  @ApiOperation({
    summary: 'Fetch a review photo',
    description: 'Public — no session required, same as a product photo (invariant 1).',
  })
  @ApiParam({ name: 'reviewId', format: 'uuid' })
  @ApiParam({ name: 'imageId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The image bytes, Content-Type set to image/jpeg or image/png.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async readImage(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.reviews.readImage(reviewId, imageId);
    response.setHeader('Content-Type', image.contentType);
    response.send(image.buffer);
  }

  @Delete(':reviewId')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ReviewIdScopeResolver)
  @ApiOperation({
    summary: 'Remove a rule-breaking review (community admin only)',
    description:
      'L3: soft delete — the row and its rating stay, it only disappears from the public list ' +
      '(never counted in the shop’s average again). A reason is required and recorded in ' +
      'audit_log. Neither the review’s own author nor the shop it is about may ever call this.',
  })
  @ApiParam({ name: 'reviewId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReviewDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not an admin of this review’s community.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such review.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already deleted.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async remove(
    @CurrentUser() actor: CurrentUserType,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: DeleteReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.remove(actor.id, reviewId, dto.reason);
  }
}
