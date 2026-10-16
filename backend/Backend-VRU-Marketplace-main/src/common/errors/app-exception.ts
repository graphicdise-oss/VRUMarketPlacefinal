import { ErrorCode, messageFor } from './error-code.js';

/** Field name → the Thai message to show beside that input. */
export type FieldErrors = Readonly<Record<string, string>>;

/**
 * The exception every service throws.
 *
 * Note what it does not extend: `HttpException`. A service is not allowed to know what an HTTP
 * status code is (CLAUDE.md: "service ไม่รู้จัก `req` / `res`"), and more practically, topic 11
 * has to send these same errors down a websocket where there is no status code to set. Keeping
 * the exception transport-agnostic is what lets the websocket filter reuse the whole mechanism
 * instead of growing a second error format — which L4 forbids in as many words.
 *
 * The HTTP status is derived from the code at the edge, in `statusFor`. The mapping lives there
 * precisely because it is an HTTP concern.
 */
export class AppException extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;
  /**
   * §100: seconds after which trying again is worth it, for a refusal that is about load rather
   * than about the request. The HTTP edge sends it as `Retry-After` (RFC 9110 §10.2.3); a service
   * says only how long, never how that is spelled on the wire.
   */
  readonly retryAfterSeconds?: number;

  /**
   * @param code      one of the central error codes
   * @param options.message  overrides the default Thai message when a specific one helps the
   *                         user more than the generic one. The `code` does not change, so the
   *                         frontend's branching is unaffected.
   * @param options.fieldErrors  per-field messages for a form
   * @param options.cause    the underlying error, for the server log only — never serialised
   * @param options.retryAfterSeconds  see the field of the same name
   */
  constructor(
    code: ErrorCode,
    options: { message?: string; fieldErrors?: FieldErrors; cause?: unknown; retryAfterSeconds?: number } = {},
  ) {
    super(options.message ?? messageFor(code), { cause: options.cause });

    this.name = 'AppException';
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/**
 * The HTTP status for a code.
 *
 * Kept beside the exception rather than inside it so that a service can throw without importing
 * anything HTTP-shaped, and so topic 11's websocket filter can ignore this function entirely.
 *
 * 500 is the default on purpose: a new code that nobody mapped should look like a server problem
 * to a monitor, not like a client mistake that quietly returns 200-adjacent.
 */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  // 400 rather than 404 or 410: the request is understood and the link in it is not usable. A 404
  // would say "no such link", which is a different claim and one this code deliberately avoids
  // making, since an expired link and an invented one answer the same way.
  VERIFICATION_LINK_INVALID: 400,
  RESET_LINK_INVALID: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  ACCOUNT_BANNED: 403,
  EMAIL_NOT_VERIFIED: 403,
  // 403 rather than 419 or 400: the request was understood and refused. A CSRF failure is not the
  // client sending a malformed body, and it is not an authentication problem either — answering
  // 401 would send a signed-in frontend into its sign-in flow over a missing header.
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  POLICY_VERSION_OUTDATED: 409,
  STALE_VIEW: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export function statusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}
