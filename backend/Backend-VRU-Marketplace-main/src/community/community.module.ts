import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CommunityAdminRevocations } from './community-admin-revocations.js';
import { CommunityAdminController } from './community-admin.controller.js';
import { CommunityAdminService } from './community-admin.service.js';
import { CommunityRequestController } from './community-request.controller.js';
import { CommunityRequestService } from './community-request.service.js';
import { CommunityController } from './community.controller.js';
import { CommunityService } from './community.service.js';
import { AdminAccountGuard } from './guards/admin-account.guard.js';
import { CommunityScopeGuard } from './guards/community-scope.guard.js';

import { CommunityIdScopeResolver } from './community-id.scope-resolver.js';

/**
 * `Community` itself (#30), who administers one (#31), and the two-tier guard every future
 * admin action is gated by (#32). One module for all three: `CommunityAdmin` has no reason to
 * exist without `Community`, and `CommunityScopeGuard` reads the table `CommunityAdminService`
 * writes. No imports needed — Prisma, the Clock and the audit writer are all global modules.
 *
 * `CommunityScopeGuard` is registered here as `APP_GUARD` rather than `@UseGuards()` per
 * controller, the same reasoning `AuthModule` gives for its own five: a route that forgot to
 * attach the guard by hand is exactly the route CLAUDE.md's "controller มีวันลืม" warns about.
 * It is a no-op on any route without `@RequiresCommunityAdmin()`, and it depends on a session
 * `AuthGuard` already resolved — safe because `AppModule` imports `AuthModule` before this one,
 * and Nest runs `APP_GUARD` providers in module-import order (see `AuthModule`'s own comment).
 *
 * `AdminAccountGuard` (§85, N29) rides here for the same reasons: it reads the same
 * `CommunityAdmin` table, is a no-op without its decorator (`@RefusesAdmins()`), and needs the
 * resolved session.
 */
@Module({
  controllers: [CommunityController, CommunityAdminController, CommunityRequestController],
  providers: [
    CommunityService,
    CommunityAdminService,
    CommunityRequestService,
    CommunityAdminRevocations,

    CommunityIdScopeResolver,
    { provide: APP_GUARD, useClass: CommunityScopeGuard },
    { provide: APP_GUARD, useClass: AdminAccountGuard },
  ],
  // §106: the admin↔shop chat gateway listens for an admin losing a community.
  exports: [CommunityAdminRevocations],
})
export class CommunityModule {}
