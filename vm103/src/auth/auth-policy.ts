/**
 * The numbers this topic runs on, in one place.
 *
 * Everything here comes from I17 (DECISIONS §10), which exists precisely so that each module
 * does not invent its own answer to "how long is a session". They are all changeable without a
 * data migration — unlike the four locked decisions in §9 — but they must have a value from the
 * first line of code rather than appearing as a literal in three files.
 *
 * Exported so that a test asserting "sixteen minutes is too late" reads the same constant the
 * code enforces. A test with its own copy of 15 passes after someone changes the policy to 10.
 */

/** I17: short enough that a ban bites quickly, long enough not to refresh on every page. */
export const ACCESS_TOKEN_TTL_MINUTES = 15;

/** I17: thirty days, and the window slides on every use — see SessionService.rotate. */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/**
 * How long a just-spent refresh token is still recognised as "this session, a moment ago" rather
 * than "unknown" — found missing in /code-review of #24/#25 (DECISIONS.md §72).
 *
 * Two tabs of the same browser holding the same refresh token can both fire `/auth/refresh` within
 * milliseconds of each other — a page reload with several tabs open, or two requests racing to
 * refresh after their access tokens expired together. Rotation's compare-and-swap correctly lets
 * exactly one of them mint a new pair; before this constant existed, the other's failed swap fell
 * straight through to `clearSessionCookies`, deleting the cookies the *winner* had just set (they
 * share one cookie jar) and signing the whole browser out — for presenting a token that was
 * perfectly legitimate a moment earlier.
 *
 * Not a security relaxation: only the winner's compare-and-swap can ever mint new credentials.
 * The loser is told "you're fine, no new pair needed" and gets no tokens at all — so a value here
 * that is too large costs nothing but a slightly longer window in which a genuinely stolen and
 * already-rotated-away token is met with silence instead of a clear refusal. Thirty seconds is
 * generous for two requests issued moments apart and short next to anything a real replay would
 * need to matter.
 */
export const REFRESH_TOKEN_RACE_GRACE_SECONDS = 30;

/** I17 · B0.1: a verification link is good for a day. */
export const EMAIL_VERIFICATION_TTL_HOURS = 24;

/**
 * I17: at most three verification emails an hour, per account — **including the one registration
 * sends**. Registering and then asking twice reaches the limit.
 *
 * I17 words it as "ขอใหม่ได้ 3 ครั้ง/ชม.", which read literally is three *resends* on top of the
 * registration email, for four in the first hour. Counting all three the same way is the stricter
 * reading and the one that matches why the number exists: Brevo allows this project about 300
 * messages a day (A4), and they are the same 300 that carry deadline warnings and dispute
 * outcomes. Which email a message was is of no interest to that quota.
 *
 * The difference is one email in the hour somebody registers, and never anything afterwards —
 * every later hour allows three. Recorded here rather than left implicit because a reader
 * comparing the code against I17 would otherwise think one of them was wrong.
 *
 * Registration itself is never *refused* by this limit, only counted by it: a registration that
 * succeeded without sending anything would strand the account.
 */
export const VERIFICATION_EMAILS_PER_HOUR = 3;

/**
 * I16: a password-reset link is good for one hour, not the twenty-four a verification link gets.
 *
 * The difference is deliberate and worth stating. A verification link proves an address; a reset
 * link is a **temporary password** for the account it belongs to, sitting in an inbox that may be
 * on a shared machine or a phone somebody else can pick up. The shorter the window, the smaller
 * the chance that the link is still live when somebody other than its owner reads it — and unlike
 * a verification link, asking for another one costs nothing.
 */
export const PASSWORD_RESET_TTL_HOURS = 1;

/**
 * I17's "3 per hour" again, counted per account and separately from verification emails.
 *
 * Separate counters rather than one shared allowance: the two flows are asked for by different
 * people in different situations, and somebody who has just registered and is waiting for a
 * verification email should not find that they cannot also reset a password. What the number
 * protects is the same thing in both cases — Brevo's ~300 messages a day (A4), shared with every
 * deadline warning and dispute outcome the marketplace sends.
 */
export const PASSWORD_RESET_EMAILS_PER_HOUR = 3;

/**
 * ⚠️ **Assumed, not decided.** Nothing in DECISIONS.md or the tickets gives a password length,
 * and a registration endpoint cannot exist without one, so this is the guess recorded in
 * PROGRESS.md's decision log and in the report for #24.
 *
 * 8 is the floor in NIST SP 800-63B, which also advises against composition rules (no "one
 * capital and one symbol") because they push people towards Password1! and towards writing it
 * down. So: a length and nothing else.
 *
 * The ceiling is a denial-of-service guard, not a security rule. argon2 hashes its input at a
 * cost this project chose deliberately; a megabyte-long password would multiply that cost by the
 * attacker's choice of number. 128 is far past any real passphrase.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Longest email this system stores, matching the VARCHAR(255) column.
 *
 * Declared here rather than only on the DTO so the validation and the column cannot drift into
 * the state where a request passes validation and the insert fails with a database error.
 */
export const MAX_EMAIL_LENGTH = 255;
