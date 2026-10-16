import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ShopModule } from '../shop/shop.module.js';
import { AccountErasureQueueSweepTask } from './account-erasure-queue.sweep-task.js';
import { AccountErasureController } from './account-erasure.controller.js';
import { AccountErasureService } from './account-erasure.service.js';

/**
 * #70/#71: PDPA erasure, immediate and queued. Imports `AuthModule` for `SessionService` (revoking
 * every session, I16's own mechanism) and `AccountMarkerService` (the one place `emailHmac` is
 * computed, #29's own writer/reader split). Everything else the service touches (`PrismaService`,
 * `AuditLogService`, `FileStorageService`, `NotificationService`, `SweepService`, `Clock`) is
 * `@Global()` already and needs no import here — the same reasoning `DisputeService.rule()` uses
 * to reach `shop`/`user`/`order` directly through `tx` rather than through each table's own module
 * (see `AccountErasureService`'s own comment).
 *
 * `AccountErasureService` is exported (#74): `AdminModule` imports this module so
 * `AdminUsersController` can reuse `requestErasureAsAdmin` — the same "reuse the existing flow,
 * don't write a second one" reasoning `ShopModule` already applies to `findOwnShopRow`.
 *
 * Imports `ShopModule` (§86) for `ShopService.closeForErasure` — an admin erasure closes a banned
 * owner's shop through the same I11 check closing it yourself goes through, not a second copy.
 */
@Module({
  imports: [AuthModule, ShopModule],
  controllers: [AccountErasureController],
  providers: [AccountErasureService, AccountErasureQueueSweepTask],
  exports: [AccountErasureService],
})
export class AccountErasureModule {}
