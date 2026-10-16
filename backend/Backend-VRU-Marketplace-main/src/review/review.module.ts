import { Module } from '@nestjs/common';
import { OrderReviewController } from './order-review.controller.js';
import { ReviewIdScopeResolver } from './review-id.scope-resolver.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { ShopReviewController } from './shop-review.controller.js';

/**
 * `Review` + `ReviewImage` (#60). No imports needed: `PrismaService`, `Clock` and the audit
 * writer are global, `FileStorageService` reaches through the `@Global()` `FilesModule` the same
 * way `PaymentSlipService` already does, and `CommunityScopeGuard`/`@RequiresCommunityAdmin()`
 * are registered globally by `AuthModule`/`CommunityModule`. `ReviewIdScopeResolver` is listed as
 * a provider only so `CommunityScopeGuard`'s `ModuleRef.get(..., { strict: false })` can find it.
 */
@Module({
  controllers: [OrderReviewController, ShopReviewController, ReviewController],
  providers: [ReviewService, ReviewIdScopeResolver],
})
export class ReviewModule {}
