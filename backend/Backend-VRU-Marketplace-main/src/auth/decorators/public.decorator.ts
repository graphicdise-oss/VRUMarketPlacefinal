import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = 'auth:isPublicRoute';

/**
 * Marks a route as reachable without signing in.
 *
 * The default is the other way round: `AuthGuard` is registered globally and refuses anything
 * that is not marked, so a controller added in topic 5 is protected before anyone thinks about
 * it. Opting out is a visible line in the diff; opting in would be a line someone forgets, and
 * the thing they forget is a route that should have needed a session.
 *
 * Public does **not** mean anonymous. The guard still resolves a session when the cookies carry
 * one, so a public route can tailor itself to whoever is signed in — which is what the product
 * and shop listings in topics 4 and 5 need, since browsing works without an account (invariant 1)
 * and a banned account is still refused here.
 *
 * ⚠️ Public does not exempt anything from CSRF. A public route that changes data — registering,
 * signing in — still needs the header; see CsrfGuard.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_ROUTE, true);
