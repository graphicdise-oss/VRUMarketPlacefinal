import type { Agent, Response } from 'supertest';
import { CSRF_HEADER } from '../../src/auth/csrf.service.js';
import { CURRENT_PRIVACY_POLICY_VERSION, CURRENT_TERMS_OF_SERVICE_VERSION } from '../../src/legal/policy-version.js';
import type { FakeGoogleIdentity } from './fake-google-identity.js';

/**
 * Driving the auth endpoints the way a browser does — over HTTP, with a real cookie jar.
 *
 * Nothing here reaches into a service. Every helper is requests a frontend could make, which is
 * what seam 1 is for: a test that called `AuthService.login` directly would prove the service
 * works and say nothing about whether the guard, the pipe, the prefix and the cookies line up.
 */

export const API = '/api/v1';

/**
 * Fetches a CSRF token bound to whatever session this client currently holds.
 *
 * Every request that changes data needs one, so most tests start here. It is a plain GET because
 * that is all the frontend does — there is no test-only shortcut, and a token minted in-process
 * would not prove that the endpoint hands out one the guard accepts.
 */
export async function csrfToken(client: Agent): Promise<string> {
  const response = await client.get(`${API}/auth/csrf`).expect(200);
  // supertest types `body` as `any`, so it is narrowed here rather than trusted.
  const token: unknown = (response.body as { csrfToken?: unknown }).csrfToken;

  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`GET /auth/csrf did not return a token: ${JSON.stringify(response.body)}`);
  }

  return token;
}

/** A password that satisfies the policy, for tests that do not care what it is. */
export const GOOD_PASSWORD = 'a-long-enough-passphrase';

/**
 * Registers an account over HTTP. Answers 202 whether or not the address was free, by design.
 */
export async function register(
  client: Agent,
  email: string,
  password = GOOD_PASSWORD,
): Promise<void> {
  await client
    .post(`${API}/auth/register`)
    .set(CSRF_HEADER, await csrfToken(client))
    // The acceptances #75 and §90 require, sent the way a real form does. Imported rather than
    // written as literals here: this helper is how every other spec in the suite makes an account,
    // so a literal would mean editing sixty files the day either version changes.
    .send({ email, password, ...CURRENT_ACCEPTANCES })
    .expect(202);
}

/**
 * What the sign-up form sends when its boxes are ticked: the privacy policy version (#75) and the
 * terms of service version (§90) the page was showing, and the age confirmation (§98). Spread into any hand-built register body so a test
 * that is about something else does not fail for want of an acceptance.
 */
export const CURRENT_ACCEPTANCES = {
  acceptedPrivacyPolicyVersion: CURRENT_PRIVACY_POLICY_VERSION,
  acceptedTermsOfServiceVersion: CURRENT_TERMS_OF_SERVICE_VERSION,
  // §98: the second box on the form — age 20 or over, or a guardian's consent.
  confirmedAgeOrGuardianConsent: true,
} as const;

/** Signs in and returns the response, so a test can assert on the body and the cookies. */
export async function login(
  client: Agent,
  email: string,
  password = GOOD_PASSWORD,
): Promise<Response> {
  return client
    .post(`${API}/auth/login`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ email, password });
}

/**
 * The common arrangement: a person with an account, signed in on this client.
 *
 * Deliberately two separate HTTP calls rather than one helper that inserts a row and mints a
 * session. Registering does not sign anyone in (the response must not reveal whether the address
 * was taken), and a test that skipped the real login would not notice the day that stops working.
 */
export async function registerAndLogin(
  client: Agent,
  email: string,
  password = GOOD_PASSWORD,
): Promise<Response> {
  await register(client, email, password);
  const response = await login(client, email, password);

  if (response.status !== 200) {
    throw new Error(`Could not sign in as ${email}: ${response.status}`);
  }

  return response;
}

/**
 * The `token` out of the link in an email body, the way a person opens their inbox and clicks.
 *
 * Read from the email rather than from the database on purpose: that round trip is what proves the
 * link was actually sent and that it carries a usable token. A test that read the row would pass
 * even if no email had ever gone out.
 */
export function linkTokenFrom(body: string): string {
  const link = /https?:\/\/\S+/.exec(body)?.[0];

  if (link === undefined) {
    throw new Error(`No link in the email:\n${body}`);
  }

  const token = new URL(link).searchParams.get('token');

  if (token === null) {
    throw new Error(`The link carries no token: ${link}`);
  }

  return token;
}

/** Asks for a password-reset link. Answers 202 whatever the address turns out to be. */
export async function forgotPassword(client: Agent, email: string): Promise<Response> {
  return client
    .post(`${API}/auth/password/forgot`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ email });
}

/** Sets a new password with the token from a reset link. */
export async function resetPassword(
  client: Agent,
  token: string,
  password: string,
): Promise<Response> {
  return client
    .post(`${API}/auth/password/reset`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ token, password });
}

/** Confirms an address with the token from its verification link. */
export async function verifyEmail(client: Agent, token: string): Promise<Response> {
  return client
    .post(`${API}/auth/verify-email`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ token });
}

/**
 * Where a 3xx points, as a parsed URL.
 *
 * supertest types `headers` as `any`; narrowing it here keeps every Google test free of casts.
 */
export function redirectTarget(response: Response): URL {
  const location: unknown = response.headers.location;

  if (typeof location !== 'string') {
    throw new Error(`Expected a redirect, got ${response.status} with no Location header.`);
  }

  return new URL(location);
}

/** The `error` the Google callback sent the browser back with, or null when it succeeded. */
export function redirectError(response: Response): string | null {
  return redirectTarget(response).searchParams.get('error');
}

/**
 * Signs in with Google the way a browser does: follow the start route, read the `state` out of
 * the URL it was redirected to, then come back to the callback with a code.
 *
 * Nothing here reaches into a service. The only thing arranged out of band is what Google would
 * have said about the person, which is the one part of the flow that lives on somebody else's
 * server.
 */
export async function signInWithGoogle(
  client: Agent,
  google: FakeGoogleIdentity,
  email: string,
  options: {
    emailVerified?: boolean;
    code?: string;
    policyVersion?: string | null;
    termsVersion?: string | null;
    /** §98: whether the page's age box was ticked — ticked unless a test says otherwise. */
    ageConfirmed?: boolean;
    /** §101: Google's own id for the account (`sub`) — one per address unless a test says otherwise. */
    subject?: string;
  } = {},
): Promise<Response> {
  // §87 · §90: the versions the page showed beside the Google button, as a real frontend sends
  // them — the current ones unless a test says otherwise, and `null` to leave one off entirely.
  const policyVersion = options.policyVersion === undefined ? CURRENT_PRIVACY_POLICY_VERSION : options.policyVersion;
  const termsVersion = options.termsVersion === undefined ? CURRENT_TERMS_OF_SERVICE_VERSION : options.termsVersion;
  const start = await client.get(`${API}/auth/google`).query({
    ...(policyVersion === null ? {} : { policyVersion }),
    ...(termsVersion === null ? {} : { termsVersion }),
    ...(options.ageConfirmed === false ? {} : { ageConfirmed: 'true' }),
  });

  if (start.status !== 302) {
    throw new Error(`GET /auth/google did not redirect: ${start.status}`);
  }

  const state = redirectTarget(start).searchParams.get('state');

  if (state === null) {
    throw new Error('GET /auth/google redirected without a state parameter.');
  }

  const code = options.code ?? `code-for-${email}`;
  google.willAccept(code, { email, emailVerified: options.emailVerified, subject: options.subject });

  return client.get(`${API}/auth/google/callback`).query({ code, state });
}

/**
 * The whole Set-Cookie header for one cookie, or undefined.
 *
 * supertest types `headers` as `any`, so everything is narrowed from `unknown` here. Doing it in
 * one place keeps the two helpers below free of casts — and the lint rules that forbid reaching
 * into an `any` are the reason this is worth a function rather than three lines each time.
 */
function setCookieHeader(response: Response, name: string): string | undefined {
  const raw: unknown = response.headers['set-cookie'];
  const all: unknown[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];

  return all
    .filter((cookie): cookie is string => typeof cookie === 'string')
    .find((cookie) => cookie.startsWith(`${name}=`));
}

/** The raw value of one Set-Cookie on a response, or undefined if it was not set. */
export function setCookie(response: Response, name: string): string | undefined {
  const header = setCookieHeader(response, name);

  if (header === undefined) {
    return undefined;
  }

  const value = header.slice(name.length + 1).split(';', 1)[0];

  // An empty value is how `clearCookie` expires a cookie. Treated as "not set", because a test
  // asking for the cookie's value wants a usable token.
  return value === undefined || value.length === 0 ? undefined : value;
}

/** The attributes on one Set-Cookie, lowercased, for asserting on HttpOnly / SameSite / Path. */
export function setCookieAttributes(response: Response, name: string): string {
  return (setCookieHeader(response, name) ?? '').toLowerCase();
}
