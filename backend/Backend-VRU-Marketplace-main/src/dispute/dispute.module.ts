import { Module } from '@nestjs/common';
import { OrderFreezeModule } from '../order/order-freeze.module.js';
import { ShopModule } from '../shop/shop.module.js';
import { DisputeAdminController } from './controllers/dispute-admin.controller.js';
import { DisputeEvidenceController } from './controllers/dispute-evidence.controller.js';
import { OrderDisputeController } from './controllers/order-dispute.controller.js';
import { ShopDisputeController } from './controllers/shop-dispute.controller.js';
import { DisputeIdScopeResolver } from './dispute-id.scope-resolver.js';
import { DisputeRulingNotificationPort, NotifyingDisputeRulingNotificationPort } from './ports/dispute-ruling-notification.port.js';
import { DisputeAdminService } from './services/dispute-admin.service.js';
import { DisputeService } from './services/dispute.service.js';

/**
 * `Dispute` + `DisputeEvidence` (#63/#64). Imports `ShopModule` for `ShopService.findOwnShopRow`
 * and `OrderFreezeModule` for `OrderFreezeService.forceUnfreeze` (J3 — a ruling releases any
 * freeze on the order it rules on) *and* for `OrderStockAdjustmentPort` (#62's own port, I7) —
 * `OrderFreezeModule` binds and exports that port so this module and `OrderModule` share one
 * singleton instance rather than each standing up its own (two bindings of even a stateless
 * `Noop` broke `app.get(OrderStockAdjustmentPort)` in tests — see `OrderFreezeModule`'s own
 * comment). Deliberately does not import `OrderModule`: nothing here needs `OrderService`
 * itself, only the plain exports `ORDER_INCLUDE`/`OrderDto` (imported directly, not as
 * providers) plus raw `Order` rows through Prisma — the same restraint `OrderFreezeService`
 * (#61) established for the same "avoid a cycle with `ShopModule`" reason.
 */
@Module({
  imports: [ShopModule, OrderFreezeModule],
  controllers: [OrderDisputeController, ShopDisputeController, DisputeEvidenceController, DisputeAdminController],
  providers: [
    DisputeService,
    DisputeAdminService,
    DisputeIdScopeResolver,
    { provide: DisputeRulingNotificationPort, useClass: NotifyingDisputeRulingNotificationPort },
  ],
  // #68: ChatModule's own community-scope resolver needs `isOrderUnderOpenDisputeBreakGlass`,
  // the one method that ticket is instructed to call rather than reimplement the open/closed rule.
  exports: [DisputeService, DisputeAdminService],
})
export class DisputeModule {}
