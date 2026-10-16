import type { Algorithm } from '@node-rs/argon2';
import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing, and the only place in this codebase that touches a password.
 *
 * argon2id, which is what #24 asks for and what OWASP recommends first. Not bcrypt: bcrypt
 * silently truncates at 72 bytes, so a long passphrase is weaker than it looks, and it has no
 * memory-hardness — a GPU farm guesses bcrypt hashes far faster than argon2id ones for the same
 * wall-clock cost to us. Not SHA-anything, and certainly nothing written here: CLAUDE.md forbids
 * both, and the reason is that a fast hash is the whole vulnerability.
 *
 * `@node-rs/argon2` rather than the `argon2` package because it ships prebuilt binaries instead
 * of compiling through node-gyp. The university server has no build toolchain to rely on, and a
 * dependency that needs a C++ compiler at install time is a deployment that fails on a machine
 * nobody wants to debug.
 *
 * Plain functions rather than a service: there is nothing to inject, nothing to configure per
 * environment and no state. A class here would only make the call sites longer.
 */

/**
 * OWASP's second recommended argon2id configuration (19 MiB, t=2, p=1), measured at ~85ms on
 * this machine.
 *
 * The memory figure is the one that matters here. This runs on a university server that is short
 * on RAM (CLAUDE.md, "ข้อจำกัดสภาพแวดล้อม"), and every concurrent login holds 19 MiB for the
 * duration of the hash. That is affordable because the login endpoint is rate limited to ten
 * attempts per fifteen minutes per IP and email (I17 · #28) — without that limit, this function
 * is a memory amplifier anyone can pull.
 *
 * ⚠️ Raising these later is safe and does not need a migration: the parameters are encoded in
 * every stored hash, so old hashes keep verifying. Lowering them weakens every password already
 * stored, because those hashes are not recomputed until their owner next signs in.
 */
/**
 * `Algorithm.Argon2id`, written as its value.
 *
 * The package declares `Algorithm` as an ambient `const enum`, and this project compiles with
 * `isolatedModules` — under which a const enum's *members* cannot be read, because each file is
 * compiled without the others and there is nothing to inline. The type annotation is what keeps
 * this honest: change the package's numbering and this stops compiling rather than quietly
 * selecting Argon2d, which is the variant that is vulnerable to side channels.
 */
const ARGON2ID: Algorithm = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * The argon2 hash of a random string that was generated once and thrown away.
 *
 * It is not a credential and nothing can sign in with it. Its only job is to give
 * `verifyPassword` something to spend the same ~85ms on when the email does not exist, so that
 * "no such account" and "wrong password" take the same time. Without it, an attacker can tell
 * which addresses are registered with a stopwatch — which would undo the care taken everywhere
 * else in this topic to answer identically for both cases (I16).
 */
const DISCARDED_INPUT_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$LSgMqOnS2g2pH/J8gpI2zQ$qL4v6gFkNahaQ2UsWmw4vLjwq5FIN8PZOxHovWEuJ5s';

export function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword, ARGON2_OPTIONS);
}

/**
 * Whether a password matches a stored hash.
 *
 * `storedHash` is nullable on purpose, and a null is not a shortcut to `false`: it means the
 * account has no password because it was created through Google (#26). Passing it through here
 * rather than branching at the call site is what keeps the timing identical — a null that
 * returned immediately would make Google-only accounts identifiable from outside.
 *
 * Returns false rather than throwing when the stored hash is malformed. A corrupt hash is a
 * failure to sign in, not a 500 that tells the caller something about the row.
 */
export async function verifyPassword(
  storedHash: string | null,
  plainPassword: string,
): Promise<boolean> {
  try {
    return await verify(storedHash ?? DISCARDED_INPUT_HASH, plainPassword);
  } catch {
    return false;
  }
}

/**
 * Spends the same work as a real verification and always fails.
 *
 * For the unknown-email branch of login. `verifyPassword(null, …)` would do the same thing, but a
 * call that reads `await wasteVerificationTime(password)` says why it is there, and the next
 * person to tidy up is less likely to delete it.
 */
export async function wasteVerificationTime(plainPassword: string): Promise<void> {
  await verifyPassword(DISCARDED_INPUT_HASH, plainPassword);
}
