import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { AppConfig } from '../config/app-config.module.js';
import { equalsInConstantTime } from './constant-time.js';

/**
 * The CSRF token that pairs with the httpOnly cookies (B3).
 *
 * **Shape:** `<nonce>.<HMAC-SHA256(CSRF_SECRET, nonce + ':' + sessionId)>`, where `sessionId` is
 * the empty string for a caller who is not signed in. It is handed out by `GET /auth/csrf` and
 * must come back in the `x-csrf-token` header on every request that changes data.
 *
 * **Why it is bound to the session.** Without the binding, anyone could fetch a token and use it
 * against anyone — the signature would prove only that the server once minted it. Bound, a token
 * is evidence that whoever holds it was able to read a response sent to *this* session, which is
 * exactly what a cross-site attacker cannot do.
 *
 * **Why there is no CSRF cookie.** The textbook double-submit pattern sends the same value as a
 * cookie and as a header and compares them. That pattern exists to give the server something to
 * compare against without keeping state, and it has a known weakness: anyone who can set a cookie
 * on the site's domain — a subdomain with an XSS, a network attacker on plain http — can satisfy
 * both halves. The session binding closes that hole and makes the cookie half redundant, so it is
 * not there. It would also be useless in the deployment this project expects: the frontend is a
 * different origin, and a cross-origin page cannot read a cookie in order to echo it.
 *
 * **What actually stops a cross-site POST**, in order of how much each contributes:
 *
 *   1. `SameSite=Lax` on the session cookies, so the browser does not attach them to a
 *      cross-site POST at all (see cookies.ts).
 *   2. The `x-csrf-token` header itself. A custom header makes the request non-simple, so the
 *      browser sends a CORS preflight first, and the allowlist in bootstrap.ts refuses any origin
 *      but the configured frontend. An attacker's page never gets to send the real request.
 *   3. This signature and its session binding, which is what remains if someone ever relaxes
 *      the first two — and someone eventually does.
 *
 * ⚠️ Point 2 is why `enableCors` must never be given `origin: true` or a reflected origin. That
 * single change would turn the CSRF token into decoration, because the attacker's page could then
 * read a token minted for the victim.
 */
@Injectable()
export class CsrfService {
  constructor(private readonly config: AppConfig) {}

  /**
   * Mints a token for a caller.
   *
   * @param sessionId the session to bind it to, or null for a caller who is not signed in —
   *   which is a real case, because registering and signing in are themselves requests that
   *   change data and need a token.
   *
   * ⚠️ The binding changes when someone signs in or out, so the token they were using stops
   * verifying. That is deliberate (a token must not survive a change of identity) and it means
   * the frontend has to fetch a new one after login and after logout. It is written down in
   * docs/FRONTEND-NOTES.md, because the symptom otherwise is a 403 on the first action after
   * signing in and an afternoon spent looking in the wrong place.
   */
  issue(sessionId: string | null): string {
    const nonce = randomBytes(18).toString('base64url');

    return `${nonce}.${this.sign(nonce, sessionId)}`;
  }

  /**
   * Whether a presented token is one we minted for this session.
   *
   * There is deliberately no expiry. The token authorises nothing on its own — it cannot read,
   * write or identify anybody — so its age is not a risk, and an expiry would mean a client that
   * sat on a page for an hour gets a 403 on its next action with no way to tell that apart from a
   * real failure. It dies with the session it is bound to, which is the lifetime that matters.
   */
  verify(presented: string | undefined, sessionId: string | null): boolean {
    if (presented === undefined) {
      return false;
    }

    // A single split, not `split('.')`: a nonce cannot contain a dot (base64url has no dot), so
    // anything with two separators is not a token this service produced.
    const separator = presented.indexOf('.');
    if (separator <= 0) {
      return false;
    }

    const nonce = presented.slice(0, separator);
    const signature = presented.slice(separator + 1);

    return equalsInConstantTime(signature, this.sign(nonce, sessionId));
  }

  /**
   * The nonce and the session, separated by a character that cannot appear in either.
   *
   * base64url's alphabet has no colon, so there is exactly one way to read `nonce:sessionId` —
   * without that, a nonce ending in part of a session id could be rearranged into a token for a
   * different session with the same signature.
   */
  private sign(nonce: string, sessionId: string | null): string {
    return createHmac('sha256', this.config.csrfSecret)
      .update(`${nonce}:${sessionId ?? ''}`)
      .digest('base64url');
  }
}

/** The header the frontend echoes the token in. Lowercase: Node normalises header names. */
export const CSRF_HEADER = 'x-csrf-token';
