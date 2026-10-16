import { CanActivate, ExecutionContext, Injectable, Type } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { readSession } from '../../auth/authenticated-request.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isAdminOfCommunity } from '../community-admin-scope.js';
import { REQUIRES_COMMUNITY_ADMIN_RESOLVER } from '../decorators/requires-community-admin.decorator.js';
import { ShopScopeResolver } from '../shop-scope-resolver.js';

/**
 * The one guard invariant 1 requires for every community-admin action, whatever the target type.
 *
 * Registered globally by `CommunityModule` (after `AuthModule`'s guards — see that module's
 * comment on `APP_GUARD` ordering, which this relies on for a resolved session to already be on
 * the request), and a no-op on any route that does not carry `@RequiresCommunityAdmin()`. That
 * mirrors `RateLimitGuard` and `VerifiedEmailGuard`: opt-in metadata read by one shared guard,
 * never a second guard hand-written per controller — CLAUDE.md forbids that in as many words.
 *
 * The two checks, in order:
 *
 *   1. Super admin passes with no `CommunityAdmin` row at all (invariant 1).
 *   2. Otherwise, the caller must hold a `CommunityAdmin` row for the community the resolver
 *      says the target belongs to.
 *
 * A target that does not exist, and a target that exists in a community the caller does not
 * administer, answer with the *same* FORBIDDEN — deliberately. Answering NOT_FOUND for the first
 * case would let a signed-in nobody enumerate which shop ids are real by watching which ones
 * come back 404 instead of 403. A super admin never hits this branch (checked first), so the one
 * caller allowed to know the difference still gets a plain 404 from the controller downstream.
 */
@Injectable()
export class CommunityScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resolverClass = this.reflector.getAllAndOverride<Type<ShopScopeResolver> | undefined>(
      REQUIRES_COMMUNITY_ADMIN_RESOLVER,
      [context.getHandler(), context.getClass()],
    );

    if (resolverClass === undefined) {
      return true;
    }

    if (context.getType() !== 'http') {
      return false;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const session = readSession(request);

    if (session === null) {
      // Unreachable in practice: nothing in this codebase pairs @Public() with
      // @RequiresCommunityAdmin(), and AuthGuard already refused an anonymous request on any
      // route that isn't. Kept explicit rather than a non-null assertion, per CLAUDE.md's ban on
      // unexplained `any` — this is the same defensive shape SuperAdminGuard uses.
      throw new AppException('UNAUTHENTICATED');
    }

    if (session.user.role === 'SUPER_ADMIN') {
      return true;
    }

    // `strict: false` — resolvers live in whichever feature module owns the target type
    // (ShopModule today, ProductModule/OrderModule/DisputeModule/ReviewModule later), not in
    // CommunityModule, so this guard cannot know their providers array at compile time.
    const resolver = this.moduleRef.get(resolverClass, { strict: false });
    const communityId = await resolver.resolveCommunityId(request);

    if (communityId === null) {
      throw new AppException('FORBIDDEN');
    }

    if (!(await isAdminOfCommunity(this.prisma, session.user, communityId))) {
      throw new AppException('FORBIDDEN');
    }

    return true;
  }
}
