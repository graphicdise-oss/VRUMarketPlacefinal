import { Injectable, OnModuleInit } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { disputeDeadline } from '../../dispute/common/dispute-deadline.js';
import { DISPUTE_WINDOW_AFTER_CANCELLED_DAYS, DISPUTE_WINDOW_AFTER_SHIPPED_DAYS } from '../../dispute/common/dispute-policy.js';
import { lockAccountRow } from '../../common/live-account-lock.js';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { addDays, addHours } from '../../time/clock.js';
import { SweepOutageService } from '../../time/sweep-outage.service.js';
import { PausableClocks, SweepTask } from '../../time/sweep.js';
import { SweepService } from '../../time/sweep.service.js';
import { ORDER_CLOCKS, clockWhere } from './order-clocks.js';
import { OrderDeadlineWarningPort } from '../ports/order-deadline-warning.port.js';
import {
  PAYMENT_CONFIRMATION_WARNING_LEAD_HOURS,
  PAYMENT_CONFIRMATION_WINDOW_DAYS,
  PAYMENT_WARNING_LEAD_HOURS,
  PAYMENT_WINDOW_HOURS,
  SHIPPING_QUOTE_WARNING_LEAD_HOURS,
  SHIPPING_QUOTE_WINDOW_HOURS,
} from './order-policy.js';
import { markRefunded } from './refund-transition.js';

/**
 * Invariant 3's three clocks, as sweep tasks — the ticket #17 left the sweep point empty for.
 * Six tasks, not three: each clock gets its own expiry task and its own "about to expire"
 * warning task (I17), because `SweepService` isolates failures per task and a bug in a warning
 * must never stop the clock it warns about from actually expiring, or the reverse.
 *
 * Every task filters on `frozenAt: null` — H3's "นาฬิกาหยุด" while frozen applies to the warning
 * countdown exactly as much as to the deadline itself. Topic 10 owns *un*freezing (and, with it,
 * restarting the relevant clock's window field so a long freeze doesn't expire the order the
 * instant it's released) — this ticket only has to make the sweep skip frozen orders, which it
 * does uniformly here, not wait for topic 10 to come back and teach it that.
 *
 * Every expiry is a conditional `updateMany` (never read-then-write) so running the sweep twice in
 * a row is naturally idempotent: the first run's own write moves the order out of the `where`
 * clause's status, so the second run's `updateMany` simply matches nothing.
 *
 * §81: each expiry task builds its "this order has expired" condition **once** and uses that same
 * object both to find candidates and as the per-row write's own `where` (plus the row's id). #69
 * split the old single bulk write into find-then-write-per-row so it could notify, but the
 * per-row write only re-checked `status` — an order frozen (or unfrozen with a fresh window)
 * between the two steps was still ended as if nothing had happened, against H3's "the clock stops
 * while frozen". Re-using the whole condition closes that gap and keeps the two halves from
 * drifting apart again.
 */

/** Clock 1: the shop has 24h from checkout to quote shipping, or the order cancels itself. */
@Injectable()
export class ShippingQuoteExpirySweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'orders.expireShippingQuote';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const cutoff = addHours(now, -SHIPPING_QUOTE_WINDOW_HOURS);
    // #61: `shippingQuoteWindowStartedAt`, not `createdAt` — H3 needs somewhere to write a fresh
    // start time on unfreeze, and `createdAt` (when the order was actually placed) must never
    // move. Every order has this set since checkout (#61); no fallback to `createdAt` is needed.
    const expired = {
      status: 'AWAITING_SHIPPING_QUOTE',
      frozenAt: null,
      shippingQuoteWindowStartedAt: { lte: cutoff },
    } satisfies Prisma.OrderWhereInput;
    // #69: candidate-then-per-row, the same shape `RefundSlipOverdueSweepTask` below already
    // uses — needed here (unlike the plain bulk `updateMany` this task used before #69) because
    // notifying both parties means knowing *which* orders were cancelled, not just how many.
    const candidates = await this.prisma.order.findMany({
      where: expired,
      select: { id: true, buyerId: true, shop: { select: { ownerId: true } } },
    });

    return cancelEach(this.prisma, this.notifications, candidates, expired, now);
  }
}

/** Clock 1's own "6 hours left" warning (I17) — fires once per order, never again. */
@Injectable()
export class ShippingQuoteWarningSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'orders.warnShippingQuoteDeadline';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
    private readonly warnings: OrderDeadlineWarningPort,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    // Within the warning window (≤6h left) but not yet expired (>0h left) — explicit on both
    // ends so this task's own correctness never depends on running before or after the expiry
    // task above in the same pass.
    const warnAt = addHours(now, -(SHIPPING_QUOTE_WINDOW_HOURS - SHIPPING_QUOTE_WARNING_LEAD_HOURS));
    const expiresAt = addHours(now, -SHIPPING_QUOTE_WINDOW_HOURS);
    const warnable = {
      status: 'AWAITING_SHIPPING_QUOTE',
      frozenAt: null,
      shippingQuoteWindowStartedAt: { lte: warnAt, gt: expiresAt },
      shippingQuoteWarningSentAt: null,
    } satisfies Prisma.OrderWhereInput;
    const candidates = await this.prisma.order.findMany({ where: warnable, select: { id: true } });

    return warnEach(this.warnings, candidates, 'SHIPPING_QUOTE', now, (id, sentAt) =>
      this.prisma.order.updateMany({ where: { ...warnable, id }, data: { shippingQuoteWarningSentAt: sentAt } }),
    );
  }
}

/** Clock 2: the buyer has 24h from the shop's shipping quote (#51) to pay and upload a slip. */
@Injectable()
export class PaymentWindowExpirySweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'orders.expirePaymentWindow';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const cutoff = addHours(now, -PAYMENT_WINDOW_HOURS);
    const expired = {
      status: 'AWAITING_PAYMENT',
      frozenAt: null,
      paymentWindowStartedAt: { lte: cutoff },
    } satisfies Prisma.OrderWhereInput;
    const candidates = await this.prisma.order.findMany({
      where: expired,
      select: { id: true, buyerId: true, shop: { select: { ownerId: true } } },
    });

    return cancelEach(this.prisma, this.notifications, candidates, expired, now);
  }
}

/** Clock 2's own "6 hours left" warning. */
@Injectable()
export class PaymentWindowWarningSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'orders.warnPaymentDeadline';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
    private readonly warnings: OrderDeadlineWarningPort,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const warnAt = addHours(now, -(PAYMENT_WINDOW_HOURS - PAYMENT_WARNING_LEAD_HOURS));
    const expiresAt = addHours(now, -PAYMENT_WINDOW_HOURS);
    const warnable = {
      status: 'AWAITING_PAYMENT',
      frozenAt: null,
      paymentWindowStartedAt: { lte: warnAt, gt: expiresAt },
      paymentWarningSentAt: null,
    } satisfies Prisma.OrderWhereInput;
    const candidates = await this.prisma.order.findMany({ where: warnable, select: { id: true } });

    return warnEach(this.warnings, candidates, 'PAYMENT', now, (id, sentAt) =>
      this.prisma.order.updateMany({ where: { ...warnable, id }, data: { paymentWarningSentAt: sentAt } }),
    );
  }
}

/**
 * Clock 3 (I1/I3b): the shop has 3 days from the current payment round's first slip to confirm
 * receipt. Expiring this is **not** a cancellation — the buyer has already transferred money, so
 * unilateral cancellation is meaningless (H5) — it moves to `REFUND_ORDERED` instead, same as I1
 * describes for this exact deadline. Stock was never cut for a `PAYMENT_SUBMITTED` order (only
 * `PAID` cuts it, #55), so the reservation still exists and is still excluded from the reserving
 * set (#50) — nothing extra to release here.
 *
 * `paymentConfirmationWindowStartedAt` has no writer yet (topic 8 is the first one) — this task
 * is correct the moment that ticket starts setting it, and does nothing until then.
 */
@Injectable()
export class PaymentConfirmationExpirySweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'orders.expirePaymentConfirmation';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const cutoff = addDays(now, -PAYMENT_CONFIRMATION_WINDOW_DAYS);
    const expired = {
      status: 'PAYMENT_SUBMITTED',
      frozenAt: null,
      paymentConfirmationWindowStartedAt: { lte: cutoff },
    } satisfies Prisma.OrderWhereInput;
    const candidates = await this.prisma.order.findMany({
      where: expired,
      select: { id: true, buyerId: true, shop: { select: { ownerId: true } } },
    });

    let handled = 0;
    for (const candidate of candidates) {
      const result = await this.prisma.order.updateMany({
        where: { id: candidate.id, ...expired },
        data: { status: 'REFUND_ORDERED', refundOrderedAt: now, updatedAt: now },
      });
      if (result.count === 0) {
        continue;
      }
      handled += 1;

      // #69 (I17): both parties, with email — the buyer is owed money automatically and the
      // shop now owes a refund it hasn't yet been told to send.
      const message = `ออเดอร์ ${candidate.id} หมดเวลาให้ร้านยืนยันเงินเข้า ระบบจึงเปลี่ยนเป็นสถานะรอคืนเงินให้อัตโนมัติ`;
      for (const userId of [candidate.buyerId, candidate.shop.ownerId]) {
        await this.notifications.notify(
          { userId, type: 'ORDER_REFUND_ORDERED_AUTO', message, targetType: 'ORDER', targetId: candidate.id },
          { subject: 'ออเดอร์เข้าสู่สถานะรอคืนเงินอัตโนมัติ', body: message },
        );
      }
    }

    return handled;
  }
}

/** Clock 3's own warning — "24 hours left", not 6, because I17 sets a longer lead time for this one. */
@Injectable()
export class PaymentConfirmationWarningSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'orders.warnPaymentConfirmationDeadline';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
    private readonly warnings: OrderDeadlineWarningPort,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const warnAt = addHours(now, -(PAYMENT_CONFIRMATION_WINDOW_DAYS * 24 - PAYMENT_CONFIRMATION_WARNING_LEAD_HOURS));
    const expiresAt = addDays(now, -PAYMENT_CONFIRMATION_WINDOW_DAYS);
    const warnable = {
      status: 'PAYMENT_SUBMITTED',
      frozenAt: null,
      paymentConfirmationWindowStartedAt: { lte: warnAt, gt: expiresAt },
      paymentConfirmationWarningSentAt: null,
    } satisfies Prisma.OrderWhereInput;
    const candidates = await this.prisma.order.findMany({ where: warnable, select: { id: true } });

    return warnEach(this.warnings, candidates, 'PAYMENT_CONFIRMATION', now, (id, sentAt) =>
      this.prisma.order.updateMany({ where: { ...warnable, id }, data: { paymentConfirmationWarningSentAt: sentAt } }),
    );
  }
}

const SEVEN_DAYS = 7;

/**
 * #65 (K11): a one-time reputation penalty, not a deadline anyone acts on — the shop still owes
 * the refund and can still upload a slip at any time after this fires (AC: "ร้านยังอัปสลิปได้หลัง
 * 7 วัน และยังควรอัป").
 *
 * §85: counted from `refundOrderedAt` alone. That column already restarts at a full window
 * whenever the order is unfrozen (H3, `OrderFreezeService.clearFreezeAndResetClock`); the old
 * rule *also* added the order's whole frozen history on top, which counted freezes that ended
 * before any refund was ordered — twenty days frozen at PAID bought the shop twenty-seven days
 * here. The flag, the recheck that no slip has landed meanwhile, and the counter all commit in one
 * transaction, so a slip uploaded while the sweep is running never gets its shop penalized, and a
 * crash between the two writes never leaves a flag without its penalty. A super admin's override
 * to SHOP_WINS waives the penalty (`refundPenaltyWaivedAt`).
 */
@Injectable()
export class RefundSlipOverdueSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'orders.flagRefundSlipOverdue';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const overdue: Prisma.OrderWhereInput = {
      status: 'REFUND_ORDERED',
      frozenAt: null,
      refundOrderedAt: { lte: addDays(now, -SEVEN_DAYS) },
      refundOverdueFlaggedAt: null,
      refundSlipFirstUploadedAt: null,
      refundPenaltyWaivedAt: null,
    };
    const candidates = await this.prisma.order.findMany({ where: overdue, select: { id: true, shopId: true } });

    let handled = 0;
    for (const candidate of candidates) {
      const penalized = await this.prisma.$transaction(async (tx) => {
        // §91 (review): the shop owner's row before the order — the user → order lock order a ban
        // follows. Flagging the order first and then writing the owner could deadlock a ban of
        // that owner landing in the same instant.
        const shop = await tx.shop.findUniqueOrThrow({ where: { id: candidate.shopId }, select: { ownerId: true } });
        await lockAccountRow(tx, shop.ownerId);
        const flagged = await tx.order.updateMany({
          where: { id: candidate.id, ...overdue },
          data: { refundOverdueFlaggedAt: now, updatedAt: now },
        });
        if (flagged.count === 0) {
          return false;
        }

        // I12: the same shop-owner counter a lost dispute already increments — K11's own AC frames
        // this as reusing that number, not minting a second "badge" for the shop page to show.
        await tx.user.update({ where: { id: shop.ownerId }, data: { disputeLostCount: { increment: 1 } } });

        return true;
      });
      if (penalized) {
        handled += 1;
      }
    }

    return handled;
  }
}

/**
 * #65 (H6/H7): the buyer has 7 days from the shop's *first* refund slip to say they got the money
 * back; silence is treated as receipt (H7's own AC: "ถือว่าได้รับเงินแล้ว"). Reaches `REFUNDED`
 * (I8) through `markRefunded`, the same transition `RefundService.confirmReceived` uses.
 *
 * §85, two changes:
 *
 * - Counted from `refundConfirmWindowStartedAt`, which restarts at a full 7 days on unfreeze (H3)
 *   — not the first slip plus the order's whole frozen history, which both counted freezes from
 *   before any slip existed and, for a freeze *during* the window, gave back only what was left.
 * - Skips an order with an open dispute nobody has ruled on yet. That dispute is the buyer's
 *   "the money never arrived" (H7: "คนที่ยังไม่ได้เงินจริงทักได้ใน 7 วันนั้น"); closing it by
 *   timeout used to end the case silently with no verdict. Once it is ruled, the loop continues:
 *   SHOP_WINS lets this close the order on the next pass, BUYER_WINS restarts the loop
 *   (`DisputeService`).
 */
@Injectable()
export class RefundBuyerConfirmExpirySweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'orders.expireRefundBuyerConfirm';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const expired: Prisma.OrderWhereInput = {
      status: 'REFUND_ORDERED',
      frozenAt: null,
      refundConfirmWindowStartedAt: { lte: addDays(now, -SEVEN_DAYS) },
      disputes: { none: { closedAt: null, verdict: null } },
    };
    const candidates = await this.prisma.order.findMany({ where: expired, select: { id: true } });

    let handled = 0;
    for (const candidate of candidates) {
      const closed = await this.prisma.$transaction(async (tx) => {
        // §95: lock the order in a statement of its own first. A dispute being opened holds the
        // order FOR SHARE, which changes nothing on the row — so an `updateMany` that queued behind
        // it went ahead on the snapshot it started with, never saw the new dispute, and
        // `markRefunded` then closed that dispute with no ruling. The next statement starts after
        // the lock is ours, and sees whatever was committed before that.
        await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${candidate.id}::uuid FOR UPDATE`;
        return markRefunded(tx, candidate.id, expired, now);
      });
      if (closed) {
        handled += 1;
      }
    }

    return handled;
  }
}

/**
 * §116: every order deadline the sweep enforces, as something an outage pauses
 * (`SweepOutageService`) — clocks 1–3, K11's seven days to send a refund slip, H7's seven days
 * for the buyer to object, and (owner's decision) D5b's window to open a dispute, through
 * `Order.disputeWindowPausedSeconds`. Each is pushed out by the outage's length, the remaining time it had
 * when the system went down kept as it was: unlike an unfreeze (H3), nobody did anything that
 * earns a fresh window, the platform simply was not there.
 *
 * Only clocks that were already running at `since` and are still running: frozen orders are left
 * alone (their clock is stopped already, and an unfreeze restarts it in full), a window opened
 * after the system came back lost nothing, and K11 has stopped once a slip is up, the penalty has
 * landed, or a ruling waived it. One statement, rows locked in id order first — the order every
 * multi-order lock here takes (§91).
 */
@Injectable()
export class OrderClocksOutagePause implements PausableClocks, OnModuleInit {
  readonly clocksName = 'orders';

  constructor(private readonly outage: SweepOutageService) {}

  onModuleInit(): void {
    this.outage.register(this);
  }

  async shiftRunningClocks(tx: Prisma.TransactionClient, since: Date, seconds: number): Promise<number> {
    const by = Prisma.sql`make_interval(secs => ${seconds}::double precision)`;
    // §122 review: each clock's running rule is the one its own sweep task enforces (`ORDER_CLOCKS`),
    // not a copy kept here.
    const runningAt = (clock: (typeof ORDER_CLOCKS)[number]) => clockWhere(clock, { lte: since });

    const clockIds = new Set<string>();
    for (const clock of ORDER_CLOCKS) {
      for (const row of await tx.order.findMany({ where: runningAt(clock), select: { id: true } })) {
        clockIds.add(row.id);
      }
    }
    const disputeIds = await this.disputeWindowsOpenAt(tx, since);

    // Both sets locked in one pass, in id order — two passes could each take part of another
    // multi-order transaction's set and wait on the rest.
    const ids = [...new Set([...clockIds, ...disputeIds])].sort();
    if (ids.length === 0) {
      return 0;
    }
    await tx.$queryRaw`SELECT id FROM "order" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;

    // Each clock is read again on the locked rows: a write that landed before the lock (a slip, a
    // quote, a freeze) decides which clock is running, not the read above. Prisma cannot add an
    // interval to a column, so the write itself is raw — on the ids Prisma just matched.
    for (const clock of ORDER_CLOCKS) {
      const still = await tx.order.findMany({ where: { ...runningAt(clock), id: { in: [...clockIds] } }, select: { id: true } });
      if (still.length === 0) {
        continue;
      }
      const column = Prisma.raw(`"${clock.startedAtColumn}"`);
      await tx.$executeRaw`UPDATE "order" SET ${column} = ${column} + ${by} WHERE id = ANY(${still.map((row) => row.id)}::uuid[])`;
    }
    if (disputeIds.length > 0) {
      await tx.order.updateMany({ where: { id: { in: disputeIds }, frozenAt: null }, data: { disputeWindowPausedSeconds: { increment: seconds } } });
    }

    return ids.length;
  }

  /**
   * §116 (owner's decision): orders whose dispute window was open when the outage began. The SQL
   * only narrows — a window cannot outlast its 15-day-from-shipping (or cancellation) leg, so
   * anything past that bound is out — and `disputeDeadline`, the one formula the dispute door
   * itself uses, decides exactly. Frozen orders are left out: a frozen order may always open a
   * dispute, and a freeze after shipping already gives its length back on unfreeze.
   */
  private async disputeWindowsOpenAt(tx: Prisma.TransactionClient, since: Date): Promise<string[]> {
    const rows = await tx.$queryRaw<
      {
        id: string;
        status: OrderStatus;
        shippedAt: Date | null;
        completedAt: Date | null;
        cancelledAt: Date | null;
        frozenDurationSeconds: number;
        disputeWindowPausedSeconds: number;
      }[]
    >`
      SELECT o.id, o.status, o.shipped_at AS "shippedAt", o.completed_at AS "completedAt", o.cancelled_at AS "cancelledAt",
             o.frozen_duration_seconds AS "frozenDurationSeconds", o.dispute_window_paused_seconds AS "disputeWindowPausedSeconds"
      FROM "order" o
      WHERE o.frozen_at IS NULL AND o.status <> 'REFUNDED'
        AND (
          (o.status = 'CANCELLED' AND o.cancelled_at <= ${since}
            AND o.cancelled_at + make_interval(days => ${DISPUTE_WINDOW_AFTER_CANCELLED_DAYS}::int, secs => o.dispute_window_paused_seconds) >= ${since})
          OR (o.status <> 'CANCELLED' AND o.shipped_at <= ${since}
            AND o.shipped_at + make_interval(days => ${DISPUTE_WINDOW_AFTER_SHIPPED_DAYS}::int, secs => o.frozen_duration_seconds + o.dispute_window_paused_seconds) >= ${since})
        )`;

    return rows
      .filter((row) => {
        const deadline = disputeDeadline(row);
        return deadline !== null && deadline.getTime() >= since.getTime();
      })
      .map((row) => row.id);
  }
}

/**
 * Shared by `ShippingQuoteExpirySweepTask` and `PaymentWindowExpirySweepTask` (#69): cancels each
 * candidate with its own conditional `updateMany` (the same "sweep runs twice" guard the plain
 * bulk `updateMany` these two tasks used before #69 got for free — here re-derived per row, since
 * notifying both parties means knowing *which* orders were actually cancelled by *this* call, not
 * just how many) and only notifies when that write actually happened. `expired` is the exact
 * condition the caller found the candidates with (§81 — see this file's header).
 */
async function cancelEach(
  prisma: PrismaService,
  notifications: NotificationService,
  candidates: { id: string; buyerId: string; shop: { ownerId: string } }[],
  expired: Prisma.OrderWhereInput,
  now: Date,
): Promise<number> {
  let handled = 0;
  for (const candidate of candidates) {
    const result = await prisma.order.updateMany({
      where: { id: candidate.id, ...expired },
      data: { status: 'CANCELLED', cancelledAt: now, updatedAt: now },
    });
    if (result.count === 0) {
      continue;
    }
    handled += 1;

    // #69: in-app only, both parties — an order disappearing on its own is worth telling both
    // sides about, even though only one of them was the one who missed the window.
    const message = `ออเดอร์ ${candidate.id} ถูกยกเลิกอัตโนมัติเพราะไม่มีความเคลื่อนไหวภายในเวลาที่กำหนด`;
    for (const userId of [candidate.buyerId, candidate.shop.ownerId]) {
      await notifications.notify({ userId, type: 'ORDER_CANCELLED_TIMEOUT', message, targetType: 'ORDER', targetId: candidate.id });
    }
  }

  return handled;
}

/**
 * §95: each caller's `markWarned` repeats the whole candidate condition, not only "not warned yet"
 * — an order frozen, answered or cancelled after the candidate read must not be warned (and must
 * not have the flag spent), the same rule `cancelEach` follows since §81.
 */
async function warnEach(
  warnings: OrderDeadlineWarningPort,
  candidates: { id: string }[],
  kind: Parameters<OrderDeadlineWarningPort['warn']>[1],
  now: Date,
  markWarned: (id: string, sentAt: Date) => Promise<{ count: number }>,
): Promise<number> {
  let handled = 0;
  for (const candidate of candidates) {
    const result = await markWarned(candidate.id, now);
    if (result.count === 1) {
      await warnings.warn(candidate.id, kind);
      handled += 1;
    }
  }

  return handled;
}
