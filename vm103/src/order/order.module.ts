import { Module } from '@nestjs/common';
import { AddressModule } from '../address/address.module.js';
import { CartModule } from '../cart/cart.module.js';
import { ShopModule } from '../shop/shop.module.js';
import {
  OrderClocksOutagePause,
  PaymentConfirmationExpirySweepTask,
  PaymentConfirmationWarningSweepTask,
  PaymentWindowExpirySweepTask,
  PaymentWindowWarningSweepTask,
  RefundBuyerConfirmExpirySweepTask,
  RefundSlipOverdueSweepTask,
  ShippingQuoteExpirySweepTask,
  ShippingQuoteWarningSweepTask,
} from './common/order-sweep.tasks.js';
import { FrozenOrderQueueController } from './controllers/frozen-order-queue.controller.js';
import { FrozenOrderController } from './controllers/frozen-order.controller.js';
import { OrderController } from './controllers/order.controller.js';
import { PaymentSlipController } from './controllers/payment-slip.controller.js';
import { RefundSlipController } from './controllers/refund-slip.controller.js';
import { ShippingSlipController } from './controllers/shipping-slip.controller.js';
import { ShopOrderController } from './controllers/shop-order.controller.js';
import { OrderFreezeModule } from './order-freeze.module.js';
import { OrderIdScopeResolver } from './order-id.scope-resolver.js';
import { NotifyingOrderDeadlineWarningPort, OrderDeadlineWarningPort } from './ports/order-deadline-warning.port.js';
import { NotifyingOrderReceivedNotificationPort, OrderReceivedNotificationPort } from './ports/order-received.port.js';
import { FrozenOrderService } from './services/frozen-order.service.js';
import { OrderService } from './services/order.service.js';
import { PaymentSlipService } from './services/payment-slip.service.js';
import { RefundService } from './services/refund.service.js';
import { ShippingService } from './services/shipping.service.js';
import { StockReservationService } from './services/stock-reservation.service.js';

/**
 * `Order` + `OrderItem` (#49) + `StockReservation` (#50) + shipping fee (#51) + manual
 * cancellation (#52) + the three-clock sweep (#53) + `PaymentSlip` (#54). Imports `CartModule`
 * (reads the caller's cart at checkout through `CartService.getCart()` — never a second query
 * re-deriving `orderable`), `AddressModule` (`AddressService.get()` for the invariant-5
 * snapshot), and `ShopModule` (`ShopService.findOwnShopRow` for "my shop's orders", and
 * `PaymentChannelService.listForShop` for L1's buyer-facing view; both exported by `ShopModule`
 * for exactly this reuse). `StockReservationService` has no controller of its own —
 * `OrderService.checkout` is its only caller, inside the same transaction. `PaymentSlipService`
 * reaches `FileStorageService` (#36) without importing anything — `FilesModule` is `@Global()`.
 *
 * The eight sweep tasks (#53/#65) register themselves into the one sweep point (`SweepService`,
 * #17) through their own `onModuleInit` — listed here as providers only so Nest instantiates them
 * at all; nothing calls them directly. Listed expiry-then-warning per clock so that, within a
 * single sweep pass, an order sitting exactly on a deadline is cancelled/refund-ordered before the
 * warning task would otherwise ask "should this get a 6-hours-left notice" — belt-and-suspenders
 * only, since each warning task's own query already excludes anything past its clock's deadline.
 * `OrderDeadlineWarningPort` and `OrderReceivedNotificationPort` (#59) are bound to #69's real
 * `Notification`-writing implementations here. `OrderFreezeModule` is imported (not
 * `OrderModule` importing `ShopModule`/`ProductModule`'s own freeze wiring — see
 * `OrderFreezeService`'s own comment) so `FrozenOrderService`/`FrozenOrderController` (#62) can
 * rule on a frozen order — and that same import brings in `OrderStockAdjustmentPort` (#62, I7),
 * bound once inside `OrderFreezeModule` itself so `DisputeModule` (#64) shares the same singleton
 * instead of each module standing up its own (see that module's own comment for why that matters).
 * `RefundService` (#65) closes the loop `REFUND_ORDERED` starts — L9/K11/H6, plus the two sweep
 * tasks above for H7's auto-close and K11's overdue penalty.
 */
@Module({
  imports: [CartModule, AddressModule, ShopModule, OrderFreezeModule],
  controllers: [OrderController, ShopOrderController, PaymentSlipController, RefundSlipController, ShippingSlipController, FrozenOrderController, FrozenOrderQueueController],
  providers: [
    OrderService,
    StockReservationService,
    PaymentSlipService,
    RefundService,
    ShippingService,
    FrozenOrderService,
    OrderIdScopeResolver,
    { provide: OrderDeadlineWarningPort, useClass: NotifyingOrderDeadlineWarningPort },
    { provide: OrderReceivedNotificationPort, useClass: NotifyingOrderReceivedNotificationPort },
    ShippingQuoteExpirySweepTask,
    ShippingQuoteWarningSweepTask,
    PaymentWindowExpirySweepTask,
    PaymentWindowWarningSweepTask,
    PaymentConfirmationExpirySweepTask,
    PaymentConfirmationWarningSweepTask,
    RefundSlipOverdueSweepTask,
    RefundBuyerConfirmExpirySweepTask,
    OrderClocksOutagePause,
  ],
})
export class OrderModule {}
