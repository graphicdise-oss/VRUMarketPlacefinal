import { Module } from '@nestjs/common';
import { AccountErasureModule } from '../account-erasure/account-erasure.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { OrderFreezeModule } from '../order/order-freeze.module.js';
import { AdminAuditLogController } from './admin-audit-log.controller.js';
import { AdminPlatformController } from './admin-platform.controller.js';
import { AdminPlatformService } from './admin-platform.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AuditLogQueryService } from './audit-log-query.service.js';
import { SuperAdminBootstrapTask } from './super-admin-bootstrap.task.js';
import { SuperAdminGrantService } from './super-admin-grant.service.js';
import { SuperAdminsController } from './super-admins.controller.js';

import { TimeModule } from '../time/time.module.js';

/**
 * What a platform super admin can do.
 *
 * Everything here sits behind `@RequiresSuperAdmin()` and everything here writes to `audit_log` —
 * including `AdminAuditLogController` (#33), which primarily *reads* it but also records an
 * `AUDIT_LOG_VIEWED` entry of its own whenever the read is a deliberate search (a filter given),
 * per the 2026-09-22 code review: reading this table is itself an action worth being able to
 * answer for later. Topic 3 adds communities and the assigning of community admins alongside;
 * the community-admin surface is a different module with a different guard, because its
 * question is about one community rather than about the platform.
 *
 * Imports AuthModule for SessionService — banning revokes every session the account holds, and
 * there is one implementation of what a session is. Imports OrderFreezeModule (#61) for the same
 * reason: banning freezes whatever the account has in flight, through the one mechanism every
 * freeze trigger shares. Imports AccountErasureModule (#74) for `AccountErasureService` —
 * `AdminUsersController`'s erase-on-behalf-of-a-banned-account route reuses that flow rather than
 * writing a second one. Imports NotificationModule (§125) for the notice an appointed super admin gets.
 */
@Module({
  imports: [AuthModule, OrderFreezeModule, AccountErasureModule, TimeModule, NotificationModule],
  controllers: [AdminUsersController, AdminAuditLogController, AdminPlatformController, SuperAdminsController],
  providers: [AdminUsersService, AuditLogQueryService, AdminPlatformService, SuperAdminGrantService, SuperAdminBootstrapTask],
})
export class AdminModule {}
