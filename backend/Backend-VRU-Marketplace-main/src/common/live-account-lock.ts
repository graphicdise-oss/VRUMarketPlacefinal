import { Prisma } from '@prisma/client';
import { AppException } from './errors/app-exception.js';

/**
 * §84's pairing with PDPA erasure, for a write that puts something new on an account: the
 * account's row `FOR SHARE`, against erasure's `FOR UPDATE` on the same row. Either the write
 * commits first and erasure sees (and overwrites) what it wrote, or erasure commits first and the
 * write is refused here — it never lands on an account that has already been anonymized.
 *
 * Shared since §87 by the shop profile edits (§86), a shop application and a payment channel's QR
 * image. `OrderService.checkout` has had its own copy since §84 and keeps it.
 *
 * §114, the system-wide rule for the `user` row: a transaction that writes only the person's
 * ordinary columns (`bannedAt`, `disputeLostCount`, …) takes it `FOR NO KEY UPDATE`, never
 * `FOR UPDATE`. `FOR UPDATE` also blocks the key lock every foreign-key check takes on the row, so
 * a transaction already holding an order and writing a column that points at the person (a payment
 * confirmed `sellerConfirmedBy` its owner, a notice to the buyer) waited on it while the first
 * waited on the order — a deadlock Postgres broke by failing one side with a 500. Erasure alone
 * keeps `FOR UPDATE`: it rewrites the email, a key column, which takes that lock regardless.
 *
 * `exclusive` (§113) takes `FOR NO KEY UPDATE` instead, for a caller that also needs its writes on
 * this account to run one at a time (the address book: its "first one / still a default / how
 * many" reads each decide a write). It still pairs with erasure the same way, and does not wait on
 * the `FOR KEY SHARE` a foreign-key insert elsewhere takes on the same row.
 */
export async function lockLiveAccount(tx: Prisma.TransactionClient, userId: string, { exclusive = false } = {}): Promise<void> {
  const [account] = exclusive
    ? await tx.$queryRaw<{ erased_at: Date | null }[]>`SELECT erased_at FROM "user" WHERE id = ${userId}::uuid FOR NO KEY UPDATE`
    : await tx.$queryRaw<{ erased_at: Date | null }[]>`SELECT erased_at FROM "user" WHERE id = ${userId}::uuid FOR SHARE`;
  if (account === undefined || account.erased_at !== null) {
    throw new AppException('UNAUTHENTICATED');
  }
}

/**
 * §114: the `user` row locked for a write to the person's own ordinary columns — the one way the
 * six transactions that serialize on an account (unban, appointing/removing an admin, ruling and
 * overriding a dispute, the overdue-refund penalty) take it, so none of them can drift back to
 * `FOR UPDATE` (see this file's top comment). Returns whether the account is erased, read under
 * the lock, or null for no such row.
 */
export async function lockAccountRow(tx: Prisma.TransactionClient, userId: string): Promise<{ erased: boolean } | null> {
  const [account] = await tx.$queryRaw<{ erased_at: Date | null }[]>`SELECT erased_at FROM "user" WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;

  return account === undefined ? null : { erased: account.erased_at !== null };
}

/**
 * Several `user` rows, each locked as `lockAccountRow` does, in id order — the order every
 * transaction holding two of them takes, so two that share a row queue behind each other instead of
 * deadlocking. Returns each row's `lockAccountRow` answer by id.
 */
export async function lockAccountRowsInIdOrder(tx: Prisma.TransactionClient, userIds: string[]): Promise<Map<string, { erased: boolean } | null>> {
  const locked = new Map<string, { erased: boolean } | null>();
  for (const id of [...new Set(userIds)].sort()) {
    locked.set(id, await lockAccountRow(tx, id));
  }

  return locked;
}
