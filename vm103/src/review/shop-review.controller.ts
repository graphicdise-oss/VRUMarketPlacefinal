import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto.js';
import { ReviewDto } from './dto/review.dto.js';
import { ReviewService } from './review.service.js';

/**
 * The public side of #60 (invariant 1): anyone browsing a shop's reviews, signed in or not. A
 * separate controller from `OrderReviewController` for the same reason `ShopOrderController` is
 * separate from `OrderController` — a different owning resource in the path, `:shopId` here
 * instead of `:orderId`.
 */
@ApiTags('reviews')
@Controller('shops/:shopId/reviews')
export class ShopReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'A shop’s reviews, newest first',
    description: 'No session required. Excludes reviews a community admin has removed (L3).',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiPaginatedResponse(ReviewDto)
  async list(@Param('shopId', ParseUUIDPipe) shopId: string, @Query() query: ListReviewsQueryDto): Promise<Page<ReviewDto>> {
    return this.reviews.listForShop(shopId, query.limit, query.cursor);
  }
}
