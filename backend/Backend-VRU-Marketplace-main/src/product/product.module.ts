import { Module } from '@nestjs/common';
import { OrderFreezeModule } from '../order/order-freeze.module.js';
import { ShopModule } from '../shop/shop.module.js';
import { ProductController } from './controllers/product.controller.js';
import { ProductIdScopeResolver } from './product-id.scope-resolver.js';
import { ProductAdminService } from './services/product-admin.service.js';
import { ProductService } from './services/product.service.js';

/**
 * `Product` + `ProductVariant` (#41). Imports `ShopModule` for `ShopService.findOwnShopRow` —
 * every write here resolves "which shop is this" the same way `PaymentChannelService` does.
 * `FileStorageService`/`AuditLogService` are not imported: `FilesModule`/`AuditModule` are
 * `@Global()`. `ProductIdScopeResolver` is registered here, not in `CommunityModule`, same
 * reasoning as `ShopIdScopeResolver` in `ShopModule` — `CommunityScopeGuard` finds it through
 * `ModuleRef` by class reference, so `CommunityModule` never has to import a feature module.
 */
@Module({
  imports: [ShopModule, OrderFreezeModule],
  controllers: [ProductController],
  providers: [ProductService, ProductAdminService, ProductIdScopeResolver],
})
export class ProductModule {}
