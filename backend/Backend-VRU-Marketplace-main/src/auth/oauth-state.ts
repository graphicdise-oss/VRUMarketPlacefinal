import type { CookieOptions, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { MS_PER_MINUTE } from '../time/clock.js';
import { equalsInConstantTime } from './constant-time.js';
import { readCookie } from './cookies.js';

/**
 * The `state` parameter of the Google sign-in flow, and the cookie it is checked against.
 *
 * This is CSRF protection for a redirect, and it is needed even though every other write in this
 * system is covered by `CsrfGuard`: the callback is a `GET` that the browser performs as a
 * top-level navigation from accounts.google.com, so there is no header to carry a token and no
 * safe method to fall back on. Without `state`, anyone could complete *their* Google sign-in in
 * *your* browser — you would end up signed in as them, and whatever you did next (list an item,
 * upload a slip, open a dispute) would happen on their account.
 *
 * The mechanism is the standard one: a random value goes out in the URL and into a cookie, and the
 * callback insists the two match. An attacker can forge the URL but cannot write a cookie onto
 * another origin, so a forged callback arrives with no cookie to match.
 *
 * Scoped to the callback path and given ten minutes, because that is the whole of its useful life —
 * the person is on Google's consent screen and then comes straight back.
 */
export const OAUTH_STATE_COOKIE = 'google_oauth_state';

const OAUTH_STATE_PATH = '/api/v1/auth/google';

/** Long enough to read a consent screen, short enough that a stale tab does not sign anyone in. */
const OAUTH_STATE_TTL_MS = 10 * MS_PER_MINUTE;

/** 256 bits from the CSPRNG, like every other unguessable value in this topic. */
export function newOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * `SameSite=Lax` is required here, not merely chosen.
 *
 * `Strict` would withhold the cookie on the navigation *back from Google*, which is cross-site by
 * definition — the flow would fail every time, for everybody, with a mismatch that looks like an
 * attack. `Lax` sends it on a top-level GET, which is exactly this one hop and nothing else.
 */
function stateCookieOptions(isProduction: boolean, maxAgeMs: number): CookieOptions {
  const secure = process.env.COOKIE_SECURE === 'false' ? false : isProduction;
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: OAUTH_STATE_PATH,
    maxAge: maxAgeMs,
  };
}

export function setOAuthStateCookie(
  response: Response,
  state: string,
  isProduction: boolean,
): void {
  response.cookie(OAUTH_STATE_COOKIE, state, stateCookieOptions(isProduction, OAUTH_STATE_TTL_MS));
}

/**
 * Removes the cookie. Called on every callback, including the failing ones: a state that has been
 * presented once is spent, or the flow would be replayable for the rest of its ten minutes.
 */
export function clearOAuthStateCookie(response: Response, isProduction: boolean): void {
  response.clearCookie(OAUTH_STATE_COOKIE, stateCookieOptions(isProduction, 0));
}

/**
 * Whether the `state` Google echoed back is the one this browser was given.
 *
 * A missing cookie or a missing parameter is a mismatch, not a pass — "no state was sent" is what
 * a forged callback looks like.
 */
export function oAuthStateMatches(request: Request, presented: string | undefined): boolean {
  const expected = readCookie(request, OAUTH_STATE_COOKIE);

  if (expected === undefined || presented === undefined) {
    return false;
  }

  return equalsInConstantTime(expected, presented);
}

/**
 * §87: the privacy policy version the page showed beside the Google button, carried across the
 * round trip to Google in a second cookie with the same path, lifetime and `SameSite` as the state
 * one. A new account is created only if it is the current version — the same check
 * `/auth/register` makes on its checkbox, so what `policy_acceptance` records is what the person
 * saw, not merely what this server held at the time (GDPR Art. 7(1) · PDPA §19: the controller
 * must be able to show what was consented to).
 *
 * Not put inside Google's `state` parameter: that value is a CSRF nonce and nothing else, and the
 * version needs no secrecy — it is compared with a constant and never used for anything else.
 */
export const OAUTH_POLICY_COOKIE = 'google_oauth_policy';

export function setOAuthPolicyCookie(response: Response, policyVersion: string, isProduction: boolean): void {
  response.cookie(OAUTH_POLICY_COOKIE, policyVersion, stateCookieOptions(isProduction, OAUTH_STATE_TTL_MS));
}

export function clearOAuthPolicyCookie(response: Response, isProduction: boolean): void {
  response.clearCookie(OAUTH_POLICY_COOKIE, stateCookieOptions(isProduction, 0));
}

export function readOAuthPolicyVersion(request: Request): string | undefined {
  return readCookie(request, OAUTH_POLICY_COOKIE);
}

/**
 * §90: the terms of service version the page showed, carried across the Google round trip exactly
 * like the policy version above — its own cookie, same path, lifetime and `SameSite` — so that a
 * new account records the terms the person ticked the box for, not whatever this server held.
 */
export const OAUTH_TERMS_COOKIE = 'google_oauth_terms';

export function setOAuthTermsCookie(response: Response, termsVersion: string, isProduction: boolean): void {
  response.cookie(OAUTH_TERMS_COOKIE, termsVersion, stateCookieOptions(isProduction, OAUTH_STATE_TTL_MS));
}

export function clearOAuthTermsCookie(response: Response, isProduction: boolean): void {
  response.clearCookie(OAUTH_TERMS_COOKIE, stateCookieOptions(isProduction, 0));
}

export function readOAuthTermsVersion(request: Request): string | undefined {
  return readCookie(request, OAUTH_TERMS_COOKIE);
}

/**
 * §98: whether the page's age box ("อายุ 20 ปีขึ้นไป หรือผู้ปกครองรับทราบและยินยอมแล้ว") was ticked
 * before the Google button was pressed, carried across the round trip like the two versions above.
 * Only its presence matters; the value is always `true`.
 */
export const OAUTH_AGE_COOKIE = 'google_oauth_age';

export function setOAuthAgeCookie(response: Response, isProduction: boolean): void {
  response.cookie(OAUTH_AGE_COOKIE, 'true', stateCookieOptions(isProduction, OAUTH_STATE_TTL_MS));
}

export function clearOAuthAgeCookie(response: Response, isProduction: boolean): void {
  response.clearCookie(OAUTH_AGE_COOKIE, stateCookieOptions(isProduction, 0));
}

export function readOAuthAgeConfirmed(request: Request): boolean {
  return readCookie(request, OAUTH_AGE_COOKIE) === 'true';
}
