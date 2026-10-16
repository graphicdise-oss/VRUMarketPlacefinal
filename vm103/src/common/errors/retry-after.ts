/**
 * The header a refusal that is about timing carries (RFC 9110 §10.2.3). Named once: RateLimitGuard
 * sets it, the exception filter sets it for `AppException.retryAfterSeconds` (§100), and bootstrap.ts
 * has to spell it identically to expose it through CORS.
 */
export const RETRY_AFTER_HEADER = 'Retry-After';
