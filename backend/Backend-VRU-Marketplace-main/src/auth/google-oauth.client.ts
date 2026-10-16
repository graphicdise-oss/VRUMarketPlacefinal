import { Injectable } from '@nestjs/common';
import { errorKindForLog } from '../common/errors/error-kind-for-log.js';
import { AppConfig } from '../config/app-config.module.js';
import { Clock, MS_PER_SECOND } from '../time/clock.js';
import { normaliseEmail } from './email-address.js';
import { GoogleExchangeResult, GoogleIdentity } from './google-identity.js';

/**
 * Google's OAuth 2.0 endpoints. Constants rather than configuration: these are Google's addresses,
 * not ours, and a deployment that could point them somewhere else is a deployment where a typo in
 * `.env` sends everybody's authorisation code to a server of somebody's choosing.
 */
const AUTHORISATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** What Google's ID token may call itself. Both spellings are current. */
const ACCEPTED_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Long enough for a slow network, short enough that a hung request does not hold a worker. */
const EXCHANGE_TIMEOUT_MS = 10 * MS_PER_SECOND;

/**
 * The real conversation with Google.
 *
 * The whole exchange happens server-to-server: the browser only ever carries the one-time `code`,
 * and the client secret never leaves this process (B3, and the AC in #26 that forbids the frontend
 * handing us a Google token).
 *
 * **The ID token's signature is deliberately not verified**, and this is the one surprising thing
 * in the file. Google's own documentation says signature validation may be skipped when the token
 * comes straight back from its token endpoint, because the TLS connection to `oauth2.googleapis.com`
 * — authenticated by Google's certificate, carrying our client secret — is already proof of where
 * the token came from. Verifying anyway would mean fetching, caching and rotating Google's JWKS,
 * which is a second network dependency with its own failure modes and a key-rotation bug waiting to
 * happen at 3am, added to defend against an attacker who would have to be terminating TLS to Google.
 *
 * ⚠️ That reasoning holds **only** because this token was received directly over TLS in
 * `exchangeCode`. An ID token that arrived any other way — posted by a frontend, read from a query
 * string — is an unverified assertion and must never be parsed by this function. The AC that
 * forbids the frontend-sends-us-a-token flow is what keeps that true, so the two are load-bearing
 * together.
 *
 * What is checked instead, because it is what a token from the right place can still get wrong:
 * the audience (it was minted for *this* client), the issuer, and the expiry.
 */
@Injectable()
export class GoogleOAuthClient extends GoogleIdentity {
  constructor(
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {
    super();
  }

  authorisationUrl(state: string): string {
    const url = new URL(AUTHORISATION_ENDPOINT);

    url.searchParams.set('client_id', this.config.googleClientId);
    url.searchParams.set('redirect_uri', this.config.googleRedirectUri);
    url.searchParams.set('response_type', 'code');
    // `openid email` and nothing else. This system needs an address and Google's word that it is
    // verified; asking for a profile or a picture would be asking for data we have no use for and
    // would then be responsible for.
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    // Someone signed into two Google accounts almost always means to choose. Without this, Google
    // picks silently and the person ends up linked to the wrong address with nothing to explain it.
    url.searchParams.set('prompt', 'select_account');

    return url.toString();
  }

  async exchangeCode(code: string): Promise<GoogleExchangeResult> {
    let response: Response;

    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.config.googleClientId,
          client_secret: this.config.googleClientSecret,
          redirect_uri: this.config.googleRedirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      });
    } catch (error) {
      // §115: the error's kind only. Its message is free text from whichever layer failed — a
      // proxy can quote the request — and this reason goes straight into a log line.
      return { ok: false, reason: `could not reach Google (${errorKindForLog(error)})` };
    }

    if (!response.ok) {
      // The body is Google's own error JSON and may quote the request. Not logged and not read:
      // the status is enough to tell a misconfigured client from an expired code.
      return { ok: false, reason: `Google refused the exchange with HTTP ${response.status}` };
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      return { ok: false, reason: 'Google answered with something that was not JSON' };
    }

    const idToken = readString(payload, 'id_token');

    if (idToken === undefined) {
      return { ok: false, reason: 'Google answered without an id_token' };
    }

    return this.accountFromIdToken(idToken);
  }

  /**
   * Reads the claims out of a token that has just arrived over TLS from Google, and checks the
   * three things TLS does not say anything about.
   */
  private accountFromIdToken(idToken: string): GoogleExchangeResult {
    const claims = decodeJwtPayload(idToken);

    if (claims === null) {
      return { ok: false, reason: 'the id_token was not a readable JWT' };
    }

    if (!ACCEPTED_ISSUERS.has(readString(claims, 'iss') ?? '')) {
      return { ok: false, reason: 'the id_token was issued by somebody other than Google' };
    }

    // The audience check is the one that matters most here: an ID token minted for a *different*
    // OAuth client is a perfectly genuine Google token, and accepting one would let the operator
    // of any other Google application sign in as any of their users here.
    if (readString(claims, 'aud') !== this.config.googleClientId) {
      return { ok: false, reason: 'the id_token was minted for a different OAuth client' };
    }

    const expiresAtSeconds = readNumber(claims, 'exp');

    if (expiresAtSeconds === undefined || expiresAtSeconds * MS_PER_SECOND <= this.clock.nowMs()) {
      return { ok: false, reason: 'the id_token had already expired' };
    }

    const email = readString(claims, 'email');
    const subject = readString(claims, 'sub');

    if (email === undefined || subject === undefined) {
      return { ok: false, reason: 'the id_token carried no email' };
    }

    return {
      ok: true,
      account: {
        email: normaliseEmail(email),
        // Strictly `=== true`. Google sends a boolean, but a missing or string claim must never
        // become "verified" by way of a truthy check — this flag is the whole of the account-
        // takeover defence in #26.
        emailVerified: readUnknown(claims, 'email_verified') === true,
        subject,
      },
    };
  }
}

/**
 * The claims of a JWT, without verifying its signature. See the class comment for why that is
 * acceptable *here specifically* and nowhere else.
 *
 * Returns null rather than throwing on anything malformed, so the caller has one failure path.
 */
function decodeJwtPayload(token: string): unknown {
  const segments = token.split('.');

  if (segments.length !== 3 || segments[1] === undefined) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/** A property of a parsed JSON value, without assuming it is an object or that the key exists. */
function readUnknown(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

function readString(value: unknown, key: string): string | undefined {
  const found = readUnknown(value, key);

  return typeof found === 'string' && found.length > 0 ? found : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  const found = readUnknown(value, key);

  return typeof found === 'number' && Number.isFinite(found) ? found : undefined;
}
