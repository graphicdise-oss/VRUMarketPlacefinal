import { Module } from '@nestjs/common';
import { NotifyingOrderStockAdjustmentPort, OrderStockAdjustmentPort } from './ports/order-stock-adjustment.port.js';
import { OrderFreezeService } from './services/order-freeze.service.js';

/**
 * #61: `OrderFreezeService` on its own, importable by `AdminModule`, `ShopModule` and
 * `ProductModule` without any of them importing `OrderModule` — see that service's own comment
 * for why a shared module was necessary here instead of exporting it from `OrderModule` directly.
 *
 * `OrderStockAdjustmentPort` (#62, I7) is bound here too, not in `OrderModule` and `DisputeModule`
 * separately — an earlier version of #64 re-bound it locally in `DisputeModule` on the reasoning
 * that a stateless no-op "costs nothing" twice, but that broke `app.get(OrderStockAdjustmentPort)`
 * in tests: with two distinct provider instances answering the same abstract-class token, the
 * instance a test spies on and the instance actually injected into `FrozenOrderService`/
 * `DisputeService` are not guaranteed to be the same object, so a spy set up through one can
 * silently miss calls made through the other (this is exactly what happened — see the #64
 * closing-out commit). `OrderFreezeModule` is already imported by both `OrderModule` and
 * `DisputeModule`, so binding it here once gives every consumer the same singleton for free.
 */
@Module({
  providers: [OrderFreezeService, { provide: OrderStockAdjustmentPort, useClass: NotifyingOrderStockAdjustmentPort }],
  exports: [OrderFreezeService, OrderStockAdjustmentPort],
})
export class OrderFreezeModule {}
