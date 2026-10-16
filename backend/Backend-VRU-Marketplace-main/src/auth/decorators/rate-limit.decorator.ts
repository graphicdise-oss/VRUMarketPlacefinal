import { SetMetadata } from '@nestjs/common';
import type { RateLimitName } from '../rate-limit.policy.js';

export const RATE_LIMIT_RULES = 'rateLimitRules';

/**
 * Puts one or more ceilings on a route (I17 · L7).
 *
 * Opt-in, unlike authentication — which is the opposite of how `@Public()` works, and on purpose.
 * A route that forgets `@Public()` is merely closed; a route that carries a rate limit it did not
 * need would be a route that stops working under ordinary use, and there is nobody here to notice
 * that quickly. So the ceilings go where somebody has thought about them, and #28 lists where
 * that is: guessing a password, and spending the shared email quota.
 *
 * Several names may be given, and all of them are checked. Registration and login each use
 * two — see `registerPerIp`/`loginPerIp` in rate-limit.policy.ts for why one is not enough on
 * either.
 */
export function RateLimited(...names: readonly [RateLimitName, ...RateLimitName[]]) {
  return SetMetadata(RATE_LIMIT_RULES, names);
}
