/**
 * Brings an email address to the one form this system stores.
 *
 * Lowercased and trimmed, because addresses are case-insensitive everywhere people actually use
 * them, and because the column is UNIQUE: without this, Foo@example.com and foo@example.com are
 * two accounts belonging to the same person with two separate order histories — which is the
 * duplicate account user story 4 of #3 rules out.
 *
 * Strictly, the local part of an address is allowed to be case-sensitive. No mail provider anyone
 * here uses treats it that way, and the alternative — two accounts that differ only in
 * capitalisation — is a support conversation nobody can win.
 *
 * Shared by the DTOs and by #26's Google sign-in, which receives an address from Google rather
 * than from a form and must match the same row.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
