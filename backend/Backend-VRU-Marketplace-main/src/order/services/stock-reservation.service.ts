import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception.js';
import { newId } from '../../common/id.js';
import { Clock } from '../../time/clock.js';
import { reservedStockOf } from '../reserved-stock.js';

/**
 * `StockReservation` (#50, invariant 3): reserves stock at order-creation time without ever
 * touching `ProductVariant.stock` itself — the real cut happens later, once, at `PAID` (#55).
 *
 * No counter column, no `expiresAt`. "How much of this variant is currently reserved" is computed
 * live from `StockReservation` joined to its order's own `status`, which is what lets a
 * reservation survive a freeze of unbounded length (H3) and a status change from any future
 * ticket (#52's cancel, #53's sweep, #55's real cut) release it automatically — there is no
 * second value for those tickets to remember to update, and nothing here can drift out of sync
 * with the order it belongs to.
 */
@Injectable()
export class StockReservationService {
  constructor(private readonly clock: Clock) {}

  /**
   * Locks `variantId` and checks `quantity` is still available, inside the same transaction the
   * order itself is created in. **Must run before `tx.order.create` touches this variant at
   * all** — an `OrderItem` row has a foreign key to `ProductVariant`, so inserting it takes an
   * implicit `FOR KEY SHARE` lock on the variant row as part of the FK check. Two concurrent
   * checkouts that both create their `OrderItem` first and only take this `FOR UPDATE` lock
   * afterward each end up holding a share lock the other needs to upgrade past — a real deadlock
   * (`40P01`), caught by this ticket's own concurrent-race test, not a hypothetical one. Taking
   * the exclusive lock here first avoids it: by the time `order.create` requests its own share
   * lock, this transaction already holds the row exclusively, and a lock a transaction already
   * holds never conflicts with itself.
   *
   * ⚠️ The AC's own two allowed techniques for "two buyers racing the last unit, only one wins"
   * are a conditional `UPDATE ... WHERE` checked by affected-row count, or a database-level
   * constraint — never `read → check → write` on an unlocked row. Reservation doesn't decrement
   * `ProductVariant.stock` itself (only #55's real cut does), so there is no single mutable
   * column here for the first technique to condition on. This uses the second: `SELECT ... FOR
   * UPDATE` locks the variant row for the rest of the transaction, so a concurrent reservation
   * attempt for the same variant blocks until this one commits or rolls back, then re-reads the
   * reservation total *including* whatever this call just added — the same serialization a
   * conditional `UPDATE` gets from Postgres's own row lock, just taken explicitly instead of as a
   * side effect of the write.
   *
   * Callers touching more than one variant in one transaction (a multi-shop checkout) must lock
   * them in a consistent order (see `OrderService.checkout`) — locking two rows in opposite
   * orders across two concurrent transactions is its own, separate way to deadlock.
   */
  async checkAndLock(tx: Prisma.TransactionClient, variantId: string, quantity: number): Promise<void> {
    const locked = await tx.$queryRaw<{ stock: number }[]>`
      SELECT stock FROM product_variant WHERE id = ${variantId}::uuid FOR UPDATE
    `;
    const variant = locked[0];
    if (variant === undefined) {
      throw new AppException('NOT_FOUND');
    }

    const alreadyReserved = (await reservedStockOf(tx, [variantId])).get(variantId) ?? 0;

    if (variant.stock - alreadyReserved < quantity) {
      throw new AppException('CONFLICT', {
        message: 'สินค้าบางรายการในตะกร้ามีไม่พอแล้ว กรุณาแก้ไขจำนวนหรือลองใหม่อีกครั้ง',
      });
    }
  }

  /** Records the reservation once its `OrderItem` exists. The lock from `checkAndLock` already covers this. */
  async record(tx: Prisma.TransactionClient, orderItemId: string, variantId: string, quantity: number): Promise<void> {
    await tx.stockReservation.create({
      data: { id: newId(), orderItemId, variantId, quantity, createdAt: this.clock.now() },
    });
  }
}
