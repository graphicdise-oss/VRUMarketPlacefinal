import { Module } from '@nestjs/common';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

/**
 * `Cart` + `CartItem` (#48). No imports from `ProductModule`/`ShopModule` — it reads
 * `PRODUCT_OWN_VISIBILITY_FILTER`/`LIVE_SHOP_FILTER` as plain exported constants (the same reason
 * `ProductService` already imports `LIVE_SHOP_FILTER` directly rather than importing `ShopModule`
 * for it), not through either module's DI graph.
 *
 * `CartService` is exported so #49's `OrderService` can read the caller's own cart at checkout
 * through the same `getCart()` every other caller uses — never a second query re-deriving what's
 * "orderable".
 */
@Module({
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
