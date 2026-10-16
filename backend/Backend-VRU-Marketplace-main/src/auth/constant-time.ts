import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two strings without leaking, through how long it took, how much of the first one was
 * right.
 *
 * `===` returns as soon as two bytes differ. For a signature an attacker supplies, that timing
 * difference is a hint they can measure and use to build a valid one a byte at a time.
 *
 * Its own module rather than living beside the session store: two services need it, and a
 * cryptographic comparison that has to be imported from `session.service.js` reads as if it were
 * about sessions. It is about bytes.
 *
 * Unequal lengths are rejected before `timingSafeEqual`, which throws on them. That comparison is
 * not constant-time, which is fine: the length of a signature is not a secret.
 */
export function equalsInConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  return left.length === right.length && timingSafeEqual(left, right);
}
