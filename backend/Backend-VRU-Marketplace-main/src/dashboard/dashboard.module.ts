import { Module } from '@nestjs/common';
import { ShopModule } from '../shop/shop.module.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { ShopDashboardController } from './shop-dashboard.controller.js';
import { ShopDashboardService } from './shop-dashboard.service.js';

/**
 * §127: read-only summaries for each role. Counts what other modules own through the conditions they
 * export (`*-queue-filters.ts`, `shop-work.ts`) rather than through their services, so it adds no
 * module dependency except `ShopModule` — for `findOwnShopRow` and the rating the storefront shows.
 */
@Module({
  imports: [ShopModule],
  controllers: [AdminDashboardController, ShopDashboardController],
  providers: [AdminDashboardService, ShopDashboardService],
})
export class DashboardModule {}
