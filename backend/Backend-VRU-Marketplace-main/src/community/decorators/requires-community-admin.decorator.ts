import { SetMetadata, Type } from '@nestjs/common';
import { ShopScopeResolver } from '../shop-scope-resolver.js';

export const REQUIRES_COMMUNITY_ADMIN_RESOLVER = 'community:requiresCommunityAdminResolver';

/**
 * Marks a route as one of the six actions a community admin may perform (invariant 1), gated by
 * the two-tier guard: the caller must hold a `CommunityAdmin` row for the community that owns the
 * route's target, or be a super admin.
 *
 * The argument is the resolver class that knows how to find *this* route's target's shop —
 * `ShopIdScopeResolver` for a route with a `:shopId` param, and one more per target type as later
 * topics add products, orders, disputes and reviews. That class must be registered as a provider
 * somewhere in the app (`CommunityScopeGuard` looks it up with `ModuleRef`, not by importing it
 * directly, so this decorator does not tie the community module to every future feature module).
 *
 *   @RequiresCommunityAdmin(ShopIdScopeResolver)
 *   @Get(':shopId/admin')
 *   adminView(@Param('shopId') shopId: string) { … }
 *
 * `@RequiresSuperAdmin()` is a different question (a platform role, checked with no target at
 * all) and stays a separate decorator — see that file.
 */
export const RequiresCommunityAdmin = (
  resolver: Type<ShopScopeResolver>,
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRES_COMMUNITY_ADMIN_RESOLVER, resolver);
