import { Prisma } from '@prisma/client';

/**
 * Whether Prisma is reporting a unique-constraint violation (P2002) — the shape every "at most
 * one of these" race (one open shop per owner, one address default, one cart per user) ends up
 * checking for after losing a check-then-create race to a concurrent request.
 *
 * Extracted here on its sixth copy (`auth.service.ts`, `google-auth.service.ts`,
 * `shop.service.ts`, `address.service.ts`, `category.service.ts`,
 * `community-admin.service.ts` each had their own) — `CartService` (#48) is the caller that
 * finally moved it. The other six are untouched: this ticket's own scope is the cart, not a
 * repo-wide cleanup, so they stay as they are until whichever of them is next touched for its own
 * reason.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
