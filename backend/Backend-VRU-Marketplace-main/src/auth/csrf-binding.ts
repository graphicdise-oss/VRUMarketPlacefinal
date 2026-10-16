import type { Request } from 'express';
import { readSession } from './authenticated-request.js';
import { readSessionCookies } from './cookies.js';
import { SessionService } from './session.service.js';

/**
 * Which session a CSRF token on this request should be bound to, or null for a caller who is not
 * signed in.
 *
 * One function rather than two, because the guard that checks a token and the endpoint that hands
 * one out have to agree exactly: a token minted against a binding the guard computes differently
 * is a 403 on the next action with nothing in the logs to explain it.
 *
 * The fallback matters. `readSession` only has an answer when the **access** token is still valid,
 * and the two requests that must work when it is not are `POST /auth/refresh` and
 * `POST /auth/logout` — both of which change data and therefore need a CSRF token. Those paths are
 * where the refresh cookie is sent (see cookies.ts), so looking the session up by either cookie
 * covers them without widening where the refresh cookie travels.
 */
export async function csrfBindingFor(
  request: Request,
  sessions: SessionService,
): Promise<string | null> {
  const resolved = readSession(request);

  if (resolved !== null) {
    return resolved.sessionId;
  }

  return sessions.findSessionIdForCsrf(readSessionCookies(request));
}
