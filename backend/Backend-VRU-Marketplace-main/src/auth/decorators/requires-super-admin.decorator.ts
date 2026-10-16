import { SetMetadata } from '@nestjs/common';

export const REQUIRES_SUPER_ADMIN = 'auth:requiresSuperAdmin';

/**
 * Marks a route as belonging to a platform super admin.
 *
 * Platform role only, from `User.role`. It is **not** the community-admin check — that one is a
 * different question (does this person administer the community this shop belongs to?), it lives
 * in topic 3, and CLAUDE.md requires it to be one shared guard for the same reason this is one
 * shared decorator.
 *
 * A super admin passes every gate a community admin passes, so topic 3's guard will let this role
 * through without a `CommunityAdmin` row. That is a rule about that guard, not about this one.
 */
export const RequiresSuperAdmin = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_SUPER_ADMIN, true);
