import type { CookieOptions, Request, Response } from 'express';
import { MS_PER_DAY, MS_PER_MINUTE } from '../time/clock.js';
import { ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS } from './auth-policy.js';

/**
 * The two cookies this system authenticates with, and every attribute on them.
 *
 * B3: both tokens live in httpOnly cookies and neither is ever returned in a response body, so
 * these helpers are the only place a raw token touches the outside world. Keeping the attributes
 * here rather than at three call sites is what stops `logout` from clearing a cookie with a
 * different Path than `login` set — which looks like "logout does not work" and is impossible to
 * spot by reading either function on its own.
 *
 * Named plainly rather than with a `__Host-` or `__Secure-` prefix. Those prefixes are enforced by
 * the browser and are genuinely stronger, but `__Host-` additionally requires `Path=/`, which
 * would undo the scoping below, and both require `Secure`, which is absent in local development —
 * so the cookie name would differ between development and production. A name that changes between
 * environments is a bug that only ever appears on the deployed machine.
 */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Where each cookie is sent.
 *
 * The access cookie goes to the whole API, because every authenticated request needs it — and
 * because topic 11's websocket handshake is an HTTP request under the same prefix, which is how
 * the socket gets authenticated without a token in the query string or the auth payload (B3
 * forbids both, and a token in a URL ends up in access logs and browser history).
 *
 * The refresh cookie goes only to `/api/v1/auth`, which is the only place anything reads it:
 * `/auth/refresh` spends it and `/auth/logout` revokes it. A cookie that is not sent is a cookie
 * that cannot leak from a request that had no use for it, and the refresh token is the valuable
 * one — it is worth thirty days.
 */
const ACCESS_COOKIE_PATH = '/api/v1';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Builds the attributes for a session cookie.
 *
 * - **httpOnly** — the point of B3. JavaScript cannot read these, so an XSS that lands on the
 *   frontend cannot walk off with the session. That is also why `/auth/me` exists: the frontend
 *   has no way to inspect its own cookies and has to ask.
 * - **secure in production only.** A `Secure` cookie is not sent over plain http, and local
 *   development is plain http — setting it unconditionally would mean nobody can sign in on their
 *   own machine. Deployment is behind Nginx with TLS (CLAUDE.md), so production gets it.
 * - **sameSite: 'lax'.** `Strict` would drop the cookie when someone arrives by clicking a link
 *   from an email — which is exactly how the verification and reset links in #25 and #27 work,
 *   and the person would land signed out for no reason they could understand. `Lax` keeps the
 *   cookie on that top-level navigation and still withholds it from cross-site POSTs, which is
 *   the first and strongest of this system's three CSRF defences (see csrf.service.ts).
 *
 *   ⚠️ `Lax` requires the frontend and the API to be **same-site** — same registrable domain, which
 *   a different port or a different path under the same host satisfies. That covers local
 *   development (localhost:5173 → localhost:3000) and the deployment, which the project owner
 *   settled on 2026-09-20 (N9, DECISIONS.md §60): **one domain, Nginx routing `/api/v1/` to this
 *   service and everything else to the frontend**, whether or not the two run on separate VMs.
 *   Separate subdomains (`app.` / `api.`) were considered and rejected — they buy nothing for
 *   scaling that Nginx path routing does not already give, and cost a CORS preflight on every
 *   mutating request. Note that they would NOT have needed a `domain` here either: a cookie set by
 *   `api.` is sent back to `api.` on same-site requests regardless of which page made them.
 *
 *   If the frontend is ever hosted on a genuinely different registrable domain, these cookies stop
 *   being sent at all and the fix is `sameSite: 'none'` with `secure: true` — which also removes
 *   defence 1 above and leans the whole CSRF story on the header and the CORS allowlist. That is a
 *   deliberate decision for whoever makes it, not a value to flip quietly.
 * - **no domain.** The cookie stays on the exact host that set it, rather than being shared with
 *   every subdomain — one of which might one day be someone else's staging site.
 */
function sessionCookieOptions(options: {
  isProduction: boolean;
  path: string;
  maxAgeMs: number;
}): CookieOptions {
  const secure = process.env.COOKIE_SECURE === 'false' ? false : options.isProduction;
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: options.path,
    maxAge: options.maxAgeMs,
  };
}

/**
 * Writes both cookies. Called by login and by refresh, which must agree on every attribute.
 *
 * `maxAge` matches each token's lifetime so the browser drops a cookie that the server would
 * refuse anyway. It is an optimisation, not the enforcement: the expiry the system actually
 * honours is the column in the session row, because a browser's clock is the user's to set.
 */
export function setSessionCookies(
  response: Response,
  tokens: { accessToken: string; refreshToken: string },
  isProduction: boolean,
): void {
  response.cookie(
    ACCESS_TOKEN_COOKIE,
    tokens.accessToken,
    sessionCookieOptions({
      isProduction,
      path: ACCESS_COOKIE_PATH,
      maxAgeMs: ACCESS_TOKEN_TTL_MINUTES * MS_PER_MINUTE,
    }),
  );

  response.cookie(
    REFRESH_TOKEN_COOKIE,
    tokens.refreshToken,
    sessionCookieOptions({
      isProduction,
      path: REFRESH_COOKIE_PATH,
      maxAgeMs: REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY,
    }),
  );
}

/**
 * Removes both cookies from the browser.
 *
 * Only half of signing out, and the half that does not matter much: the session row is revoked
 * server-side, which is what makes the cookie the browser may have kept a copy of useless. This
 * is the tidy-up, so that the next request is cleanly anonymous instead of presenting a dead
 * token and getting a 401 the frontend has to interpret.
 *
 * Every attribute except `maxAge` must match what was set, or the browser treats it as a
 * different cookie and keeps the original — the classic "logout does nothing" bug.
 */
export function clearSessionCookies(response: Response, isProduction: boolean): void {
  response.clearCookie(
    ACCESS_TOKEN_COOKIE,
    sessionCookieOptions({ isProduction, path: ACCESS_COOKIE_PATH, maxAgeMs: 0 }),
  );
  response.clearCookie(
    REFRESH_TOKEN_COOKIE,
    sessionCookieOptions({ isProduction, path: REFRESH_COOKIE_PATH, maxAgeMs: 0 }),
  );
}

/**
 * Reads a cookie, or undefined.
 *
 * Goes through `request.cookies`, which cookie-parser fills in (registered as middleware in
 * AuthModule). The narrowing is not ceremony: `cookies` is typed loosely enough that a
 * non-string would flow onwards as if it were a token, and a token is something this system
 * hashes and looks up.
 */
export function readCookie(request: Request, name: string): string | undefined {
  const value: unknown = request.cookies?.[name];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The pair of raw tokens a request carries, for the handlers that work off the cookies. */
export function readSessionCookies(request: Request): {
  accessToken?: string;
  refreshToken?: string;
} {
  return {
    accessToken: readCookie(request, ACCESS_TOKEN_COOKIE),
    refreshToken: readCookie(request, REFRESH_TOKEN_COOKIE),
  };
}
