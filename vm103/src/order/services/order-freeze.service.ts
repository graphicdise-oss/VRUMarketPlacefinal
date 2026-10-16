import { Injectable } from '@nestjs/common';
import { FreezeReason, Prisma } from '@prisma/client';
import { AuditLogService } from '../../audit/audit-log.service.js';
import { newId } from '../../common/id.js';
import { communityAdminsToNotify } from '../../community/community-admin-scope.js';
import { NotificationService } from '../../notification/notification.service.js';
import { NON_TERMINAL_STATUSES, UNPAID_STATUSES } from '../common/order-status-sets.js';

/**
 * #61: the one mechanism every freeze trigger shares (I6/I10/H2/H4) — "ห้ามเขียนโค้ดชุดที่สอง" is
 * this ticket's own AC, so every caller (seller ban, buyer ban, shop suspension, a product ruled
 * `PROHIBITED`) goes through the same handful of methods here rather than poking `frozenAt`
 * directly.
 *
 * Lives in its own module (`OrderFreezeModule`) rather than inside `OrderModule` on purpose:
 * `AdminModule` (bans), `ShopModule` (suspensions) and `ProductModule` (PROHIBITED rejections)
 * all need to call this, and `OrderModule` already imports `ShopModule` — importing `OrderModule`
 * from `ShopModule` back would be circular. This service touches only `Order`/`OrderFreezeReason`
 * through Prisma directly, so it has no reason to depend on any of those feature modules either.
 *
 * Every method takes the caller's own transaction client: freezing must commit atomically with
 * the ban/suspension/rejection that caused it, or a rolled-back ban could leave an order frozen
 * for a reason that, as far as the rest of the system is concerned, never happened.
 */
/**
 * §87: an order `handleProhibitedProduct` cancelled, for the caller to tell its buyer once the
 * transaction has committed — the notice used to be skipped, so the order just turned CANCELLED.
 */
export interface CancelledForProhibitedProduct {
  readonly orderId: string;
  readonly buyerId: string;
}

interface AccountOrder {
  readonly id: string;
  readonly buyerId: string;
  readonly shop: { readonly ownerId: string };
}

/** Which ban reasons an order carries for `userId` — buyer, seller, or (if nothing forbids it) both. */
function banReasonsFor(order: AccountOrder, userId: string): FreezeReason[] {
  const reasons: FreezeReason[] = [];
  if (order.buyerId === userId) {
    reasons.push('BUYER_BANNED');
  }
  if (order.shop.ownerId === userId) {
    reasons.push('SELLER_BANNED');
  }
  return reasons;
}

@Injectable()
export class OrderFreezeService {
  constructor(
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * I10/H2: a banned account's every non-terminal order — as the buyer (`BUYER_BANNED`) and as the
   * owner of any shop, closed ones included (`SELLER_BANNED` — §92: a closed shop can still have a
   * `SHIPPED` order in flight).
   *
   * §95: one pass over both sides, in id order. It used to be the buyer's orders (sorted) and then
   * each shop's (sorted again), so two bans at once — two sellers who had bought from each other —
   * each held its own purchase and waited on the other's: a deadlock. §91's reason for sorting
   * holds only if every freeze sorts the whole set it touches.
   */
  async freezeOrdersForAccount(tx: Prisma.TransactionClient, actorUserId: string | null, userId: string, now: Date): Promise<void> {
    const orders = await this.ordersOfAccount(tx, userId, { status: { in: [...NON_TERMINAL_STATUSES] } });
    for (const order of orders) {
      for (const reason of banReasonsFor(order, userId)) {
        await this.addReason(tx, actorUserId, order.id, reason, now);
      }
    }
  }

  /** Undoes `freezeOrdersForAccount` — lifting a ban. Same single id-ordered pass. */
  async unfreezeOrdersForAccount(tx: Prisma.TransactionClient, actorUserId: string | null, userId: string, now: Date): Promise<void> {
    const orders = await this.ordersOfAccount(tx, userId, { frozenAt: { not: null } });
    for (const order of orders) {
      for (const reason of banReasonsFor(order, userId)) {
        await this.removeReason(tx, actorUserId, order.id, reason, now);
      }
    }
  }

  /**
   * I10/H2: every non-terminal order this shop is the seller on (shop suspension).
   *
   * §91 (review): this and every other method here lock their orders in id order, so two freezes
   * over overlapping sets (a buyer's ban and a seller's suspension sharing two orders) take the
   * shared rows in the same order and queue instead of deadlocking.
   */
  async freezeOrdersForShop(
    tx: Prisma.TransactionClient,
    actorUserId: string | null,
    shopId: string,
    reason: FreezeReason,
    now: Date,
  ): Promise<void> {
    const orders = await tx.order.findMany({ where: { shopId, status: { in: [...NON_TERMINAL_STATUSES] } }, select: { id: true }, orderBy: { id: 'asc' } });
    for (const order of orders) {
      await this.addReason(tx, actorUserId, order.id, reason, now);
    }
  }

  /** Undoes `freezeOrdersForShop` for the same reason — lifting a suspension. */
  async unfreezeOrdersForShop(
    tx: Prisma.TransactionClient,
    actorUserId: string | null,
    shopId: string,
    reason: FreezeReason,
    now: Date,
  ): Promise<void> {
    const orders = await tx.order.findMany({ where: { shopId, frozenAt: { not: null } }, select: { id: true }, orderBy: { id: 'asc' } });
    for (const order of orders) {
      await this.removeReason(tx, actorUserId, order.id, reason, now);
    }
  }

  /**
   * H4: a product ruled `PROHIBITED` reaches into every non-terminal order carrying it and picks
   * one of two fates per order, never a third: **unpaid** (`UNPAID_STATUSES` — no slip is up, so
   * no money can have moved) is cancelled outright and its reservation releases for free, the same
   * way any other cancellation does; **paid** — which since §85 includes `PAYMENT_SUBMITTED`, the
   * buyer having already transferred (H5) — freezes instead, for an admin to rule on.
   * `cancelledBy` stays null — this is a system consequence of a moderation decision, not either
   * party's own cancel button (#52), the same restraint the three-clock sweep's own auto-cancels
   * already use.
   *
   * §85: each order's status is re-read under its row lock, so an order that moved on meanwhile
   * (say, to PAID) is frozen rather than cancelled from a stale read. Cancelling an order that was
   * *already* frozen for another reason also lifts that freeze — a CANCELLED order still flagged
   * frozen used to sit in the admin queue and block its shop from closing (I11) forever.
   */
  async handleProhibitedProduct(
    tx: Prisma.TransactionClient,
    actorUserId: string | null,
    productId: string,
    now: Date,
  ): Promise<CancelledForProhibitedProduct[]> {
    const affected = await tx.order.findMany({
      where: { items: { some: { variant: { productId } } }, status: { in: [...NON_TERMINAL_STATUSES] } },
      select: { id: true },
      // §95: id order, like every other freeze here — a suspension of the same shop (the two tend
      // to come from the same report) used to be able to take the shared orders the other way round.
      orderBy: { id: 'asc' },
    });

    const cancelled: CancelledForProhibitedProduct[] = [];
    for (const { id } of affected) {
      const order = await this.lockOrder(tx, id);
      if (!NON_TERMINAL_STATUSES.includes(order.status)) {
        continue;
      }
      if (!UNPAID_STATUSES.includes(order.status)) {
        await this.addReason(tx, actorUserId, id, 'PRODUCT_PROHIBITED', now);
        continue;
      }

      await tx.order.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelReason: 'สินค้าชิ้นหนึ่งในออเดอร์นี้ถูกตัดสินว่าเป็นของต้องห้าม ออเดอร์นี้จึงถูกยกเลิก',
          cancelledAt: now,
          updatedAt: now,
        },
      });
      const lifted = await tx.orderFreezeReason.deleteMany({ where: { orderId: id } });
      if (lifted.count > 0) {
        await this.clearFreezeAndResetClock(tx, actorUserId, id, now, { reason: 'ยกเลิกเพราะสินค้าในออเดอร์ถูกตัดสินว่าเป็นของต้องห้าม (H4)', notifyBuyer: false });
      }
      cancelled.push({ orderId: id, buyerId: order.buyerId });
    }

    return cancelled;
  }

  /**
   * Idempotent: re-adding a reason already in effect for this order touches nothing (the unique
   * constraint on `(orderId, reason)` is what makes that safe to call without checking first).
   * `ORDER_FROZEN` is only written the instant `frozenAt` actually transitions from null — a
   * second cause stacking onto an already-frozen order is a real change to `freezeReasons` but
   * not a change to whether the order is frozen, so it gets no audit entry of its own (the first
   * cause's entry already answers "when did this order become frozen").
   *
   * §85: `frozenAt` is read under the order's row lock, the same lock `removeReason` takes. Before,
   * lifting a seller ban while the shop was being suspended could interleave so that the
   * suspension saw the order as still frozen (and so never set `frozenAt`) while the unban cleared
   * it a moment later — leaving a live `SHOP_SUSPENDED` reason on an order whose clocks ran on.
   */
  private async addReason(tx: Prisma.TransactionClient, actorUserId: string | null, orderId: string, reason: FreezeReason, now: Date): Promise<void> {
    const order = await this.lockOrder(tx, orderId);
    // §95: every caller chose this order from a read without its lock. The buyer marking it
    // received — or a cancel, a refund confirmed, a clock running out — could have finished it
    // since, and a finished order that is frozen never thaws on its own, blocks its shop from
    // closing, and let an admin's TERMINATE send a COMPLETED order back to REFUND_ORDERED.
    if (!NON_TERMINAL_STATUSES.includes(order.status)) {
      return;
    }

    await tx.orderFreezeReason.upsert({
      where: { orderId_reason: { orderId, reason } },
      create: { id: newId(), orderId, reason, createdAt: now },
      update: {},
    });

    if (order.frozenAt === null) {
      await tx.order.update({ where: { id: orderId }, data: { frozenAt: now, updatedAt: now } });
      await this.audit.record(
        { actorUserId, action: 'ORDER_FROZEN', targetType: 'ORDER', targetId: orderId, reason, communityId: order.shop.communityId },
        tx,
      );
      // #69: in-app only, the buyer — this is a stacking cause's first one only (frozenAt was
      // null a moment ago), the same "no second entry for a second cause" reasoning the audit
      // entry just above already carries.
      await this.notifications.record(
        {
          userId: order.buyerId,
          type: 'ORDER_FROZEN',
          message: 'ออเดอร์นี้ถูกแช่แข็งชั่วคราว รอแอดมินตัดสินใจ',
          targetType: 'ORDER',
          targetId: orderId,
        },
        tx,
      );
      // §102: and the community's admins, who have to rule on it — one notice per order, because
      // each one is its own ruling. Not its parties, should one of them be an admin (N28).
      const admins = await communityAdminsToNotify(tx, order.shop.communityId, { buyerId: order.buyerId, shopOwnerId: order.shop.ownerId });
      for (const userId of admins) {
        await this.notifications.record(
          {
            userId,
            type: 'ORDER_FROZEN_AWAITING_RULING',
            message: 'มีออเดอร์ในชุมชนที่คุณดูแลถูกแช่แข็ง รอแอดมินตัดสินว่าจะปล่อยเดินต่อหรือยุติ',
            targetType: 'ORDER',
            targetId: orderId,
          },
          tx,
        );
      }
    }
  }

  /**
   * Removes one cause. If others remain, the order stays frozen — this is what lets "ban seller"
   * and "suspend shop" stack on the same order and only fully clear once both are undone. Only
   * when the last row is deleted does the order actually unfreeze, via `clearFreezeAndResetClock`.
   * Takes the same row lock as `addReason` first (§85).
   */
  private async removeReason(tx: Prisma.TransactionClient, actorUserId: string | null, orderId: string, reason: FreezeReason, now: Date): Promise<void> {
    await this.lockOrder(tx, orderId);

    const deleted = await tx.orderFreezeReason.deleteMany({ where: { orderId, reason } });
    if (deleted.count === 0) {
      return;
    }

    const remaining = await tx.orderFreezeReason.count({ where: { orderId } });
    if (remaining === 0) {
      await this.clearFreezeAndResetClock(tx, actorUserId, orderId, now, { reason: `เหตุแช่แข็งสุดท้ายถูกยกเลิก: ${reason}`, notifyBuyer: true });
    }
  }

  /**
   * #62's own primitive: an admin's "ปล่อยเดินต่อ" (release) verdict on a frozen order overrides
   * every cause at once, regardless of how many are stacked — an admin judgment call is
   * deliberately stronger than the automatic reason bookkeeping `removeReason` does. Harmless
   * no-op on an order that isn't frozen.
   *
   * §85: takes the row lock like the other two, and a `why` — recorded on `ORDER_UNFROZEN` (#61:
   * "การแช่แข็งและปลดทุกครั้ง ลง audit_log พร้อมเหตุ") — plus whether the buyer should get the
   * usual "continue as normal" notice. A TERMINATE verdict passes `notifyBuyer: false` and sends
   * its own, truthful notice instead: telling a buyer whose order was just cancelled or sent to
   * refund that it can "continue as normal" was simply wrong.
   */
  async forceUnfreeze(
    tx: Prisma.TransactionClient,
    actorUserId: string | null,
    orderId: string,
    now: Date,
    why: { reason: string; notifyBuyer: boolean },
  ): Promise<void> {
    await this.lockOrder(tx, orderId);

    const deleted = await tx.orderFreezeReason.deleteMany({ where: { orderId } });
    if (deleted.count === 0) {
      return;
    }

    await this.clearFreezeAndResetClock(tx, actorUserId, orderId, now, why);
  }

  /** `userId`'s orders on either side of the trade, in id order — `freezeOrdersForAccount`'s single pass. */
  private async ordersOfAccount(tx: Prisma.TransactionClient, userId: string, where: Prisma.OrderWhereInput): Promise<AccountOrder[]> {
    return tx.order.findMany({
      where: { ...where, OR: [{ buyerId: userId }, { shop: { ownerId: userId } }] },
      select: { id: true, buyerId: true, shop: { select: { ownerId: true } } },
      orderBy: { id: 'asc' },
    });
  }

  /** `SELECT ... FOR UPDATE` on the order row, then the columns every caller here needs, read under it. */
  private async lockOrder(tx: Prisma.TransactionClient, orderId: string) {
    await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${orderId}::uuid FOR UPDATE`;

    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        frozenAt: true,
        frozenDurationSeconds: true,
        buyerId: true,
        refundConfirmWindowStartedAt: true,
        shop: { select: { communityId: true, ownerId: true } },
      },
    });
  }

  /**
   * H3: unfreezing gives whichever clock was running a **fresh full window**, not the remainder
   * it had left — the AC's own test is "1 hour left when frozen, 3 days frozen, unfrozen → a
   * full new 24 hours", not "1 hour left". Resetting the relevant `...WindowStartedAt` column to
   * `now` is what does that; the matching `...WarningSentAt` flag is cleared alongside it so the
   * fresh window's own "hours left" warning can fire again instead of staying permanently
   * suppressed by the round that got frozen.
   *
   * `PAID`/`SHIPPED` are unbounded by design (D5) and have no clock to reset. `REFUND_ORDERED`
   * has two (#65): K11's `refundOrderedAt` and — §85 — H7's `refundConfirmWindowStartedAt`
   * (once a refund slip has started it), both restarted here the same way. Before §85 H7 instead
   * credited the order's whole frozen history onto a fixed start, which also counted freezes from
   * before any slip existed.
   *
   * #63: also accumulates this episode's length into `Order.frozenDurationSeconds` — D5b's
   * dispute-filing deadline is a *fixed* deadline counted from `shippedAt`, so the only way to
   * make frozen time not count against it is to add the frozen span back on top of that fixed
   * deadline. Every freeze episode ends here, so this is the one place that can total them.
   */
  private async clearFreezeAndResetClock(
    tx: Prisma.TransactionClient,
    actorUserId: string | null,
    orderId: string,
    now: Date,
    why: { reason: string; notifyBuyer: boolean },
  ): Promise<void> {
    const order = await this.lockOrder(tx, orderId);

    const elapsedSeconds = order.frozenAt === null ? 0 : Math.round((now.getTime() - order.frozenAt.getTime()) / 1000);

    const data: Prisma.OrderUpdateInput = {
      frozenAt: null,
      updatedAt: now,
      frozenDurationSeconds: order.frozenDurationSeconds + elapsedSeconds,
    };
    if (order.status === 'AWAITING_SHIPPING_QUOTE') {
      data.shippingQuoteWindowStartedAt = now;
      data.shippingQuoteWarningSentAt = null;
    } else if (order.status === 'AWAITING_PAYMENT') {
      data.paymentWindowStartedAt = now;
      data.paymentWarningSentAt = null;
    } else if (order.status === 'PAYMENT_SUBMITTED') {
      data.paymentConfirmationWindowStartedAt = now;
      data.paymentConfirmationWarningSentAt = null;
    } else if (order.status === 'REFUND_ORDERED') {
      data.refundOrderedAt = now;
      if (order.refundConfirmWindowStartedAt !== null) {
        data.refundConfirmWindowStartedAt = now;
      }
    }

    await tx.order.update({ where: { id: orderId }, data });
    await this.audit.record(
      { actorUserId, action: 'ORDER_UNFROZEN', targetType: 'ORDER', targetId: orderId, reason: why.reason, communityId: order.shop.communityId },
      tx,
    );
    if (why.notifyBuyer) {
      // #69: in-app only, the buyer.
      await this.notifications.record(
        {
          userId: order.buyerId,
          type: 'ORDER_UNFROZEN',
          message: 'ออเดอร์นี้ถูกปลดแช่แข็งแล้ว ดำเนินการต่อได้ตามปกติ',
          targetType: 'ORDER',
          targetId: orderId,
        },
        tx,
      );
    }
  }
}
