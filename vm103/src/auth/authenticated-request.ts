import type { UserRole } from '@prisma/client';

/**
 * Who the caller is, as every guard, controller and later topic sees them.
 *
 * Read from the database on the request that uses it — never decoded from the token. Invariant 7
 * is the reason: a ban has to bite on the next request, and anything carried inside a token was
 * true when the token was minted and says nothing about now.
 *
 * Deliberately small. It is not the User row: no password hash can leak through it, and the
 * fields a later topic wants (an address, a shop) are a query away in the topic that wants them.
 * `bannedAt` is absent because the guard refuses a banned account outright, so code downstream
 * would be holding a field that is always null.
 */
export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  /** B0.1 gates ordering and opening a shop on this. #25 owns the email that sets it. */
  readonly emailVerified: boolean;
}

/** The resolved session behind a request: which device, and whose. */
export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly user: CurrentUser;
}

/**
 * Where the resolved session lives between the guard and the controller.
 *
 * A WeakMap keyed by the request object rather than `request.user = …`. Two reasons, and the
 * second is the one that decided it:
 *
 *   1. Assigning to the request means either declaring a property on Express's `Request`
 *      interface from inside a feature module — a global type change that every other module then
 *      sees and can write to — or an `any`, which CLAUDE.md does not allow without a reason.
 *   2. Nothing outside this file can reach the value. A later controller cannot invent its own
 *      `request.user` and have it honoured, and nothing can overwrite what the guard decided,
 *      because the only writer is `attachSession` below.
 *
 * Weak keys mean the entry disappears with the request object; there is nothing to clean up and
 * no way for one request's identity to outlive it.
 */
const sessionsByRequest = new WeakMap<object, AuthenticatedSession>();

/** Called by AuthGuard, once, after it has resolved and checked the session. */
export function attachSession(request: object, session: AuthenticatedSession): void {
  sessionsByRequest.set(request, session);
}

/** The session AuthGuard resolved, or null for an anonymous request. */
export function readSession(request: object): AuthenticatedSession | null {
  return sessionsByRequest.get(request) ?? null;
}
