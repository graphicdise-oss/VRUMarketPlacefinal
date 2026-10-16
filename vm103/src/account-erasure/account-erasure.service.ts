import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AccountMarkerService } from '../auth/account-marker.service.js';
import { SessionService } from '../auth/session.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { communityAdminGrantEntry } from '../community/community-admin-scope.js';
import { canOpenDisputeNow, disputeDeadline } from '../dispute/common/dispute-deadline.js';
import { DISPUTE_WINDOW_AFTER_CANCELLED_DAYS, DISPUTE_WINDOW_AFTER_RECEIVED_DAYS, DISPUTE_WINDOW_AFTER_SHIPPED_DAYS } from '../dispute/common/dispute-policy.js';
import { FileStorageService } from '../files/file-storage.service.js';
import { NotificationService } from '../notification/notification.service.js';
import { NON_TERMINAL_STATUSES } from '../order/common/order-status-sets.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ShopService } from '../shop/services/shop.service.js';
import { addDays, addSeconds, Clock } from '../time/clock.js';
import {
  ERASED_BUYER_TEXT_PLACEHOLDER,
  ERASED_CHAT_MESSAGE_PLACEHOLDER,
  ERASED_DISPUTE_TEXT_PLACEHOLDER,
  ERASED_LINE_PLACEHOLDER,
  ERASED_NAME_PLACEHOLDER,
  ERASED_PHONE_PLACEHOLDER,
  ERASED_POSTAL_CODE_PLACEHOLDER,
  ERASED_SHOP_NAME_PLACEHOLDER,
  erasedEmailPlaceholder,
} from './erasure-placeholders.js';

/**
 * Why an order holds a request up (§96 — H9's "บอกเหตุผล"):
 * - `ORDER_IN_PROGRESS`: the order itself has not finished (H9/H10).
 * - `OPEN_DISPUTE`: a dispute on it is still open, whatever the order's status — nobody would be
 *   left to answer it, or to pay back / be paid back if the buyer wins (§84, §94).
 * - `DISPUTE_WINDOW`: seller side only — the order has finished, but its buyer can still open a
 *   dispute (owner's decision, §94). Clears on its own when that window ends.
 */
export const ERASURE_BLOCKER_REASONS = ['ORDER_IN_PROGRESS', 'OPEN_DISPUTE', 'DISPUTE_WINDOW'] as const;
export type ErasureBlockerReason = (typeof ERASURE_BLOCKER_REASONS)[number];

/** One order still keeping a request from clearing — enough for a caller to explain why. */
export interface ErasureBlocker {
  readonly orderId: string;
  readonly role: 'BUYER' | 'SELLER';
  readonly status: OrderStatus;
  readonly reason: ErasureBlockerReason;
  /**
   * When this one order stops blocking on its own, with no further action from anyone: H10's 15
   * days after `shippedAt` for a `SHIPPED`, unfrozen order, or the end of the dispute window for
   * `DISPUTE_WINDOW`. `null` otherwise: something (a payment, a confirmation, a refund, a ruling)
   * still has to happen first.
   */
  readonly clearsAt: Date | null;
}

export type ErasureRequestResult =
  | { readonly outcome: 'ERASED' }
  | { readonly outcome: 'QUEUED'; readonly requestedAt: Date; readonly blockers: ErasureBlocker[] };

export type ErasureStatusResult =
  | { readonly status: 'NONE' }
  | { readonly status: 'QUEUED'; readonly requestedAt: Date; readonly blockers: ErasureBlocker[]; readonly blockedByOpenShop: boolean }
  | { readonly status: 'ERASED'; readonly erasedAt: Date };

/**
 * What `performErasure` found once it held the account's row lock (§84). `NOT_QUEUED` is the
 * sweep's own case (§87): the request it picked up was withdrawn — an unban — before the lock.
 */
type ErasureAttempt = 'ERASED' | 'ALREADY_ERASED' | 'BLOCKED' | 'NOT_QUEUED' | 'NOT_BANNED' | 'NOT_UNPROVEN';

/** §96: `requestErasureAsAdmin`'s precondition, and the one answer it gets once it no longer holds. */
const NOT_BANNED_MESSAGE = 'บัญชีนี้ไม่ได้ถูกแบน ให้เจ้าของบัญชีขอลบข้อมูลเองผ่าน self-service แทน';

/** The read side of Prisma both the shared client and a transaction satisfy — for `findBlockers`/`hasOpenShop`. */
type ErasureReader = Pick<Prisma.TransactionClient, 'order' | 'shop'>;

/**
 * #70/#71/#74 (G3 · H8 · H9 · H10 · K15 · K16 · N4): the one place in this system that anonymizes
 * an account. Overwrites, never `DELETE`s (invariant 5's own PDPA exception, and the "ของที่เปลี่ยน
 * ทีหลังแล้วเจ็บ" rule in CLAUDE.md locks this in independently) — every row this ticket touches
 * keeps its id and its place in every other table's history.
 *
 * A request arriving while the caller still owns an open shop is refused outright — only the
 * owner can close it (K15), so queuing would not help. A request arriving while an order (as
 * buyer *or* seller) is still non-terminal is **not** refused (#70's own scope stopped there) —
 * it is queued (H9) and `AccountErasureQueueSweepTask` clears it the moment nothing blocks
 * anymore, including H10's own rule that a `SHIPPED` order blocks for at most 15 more days
 * regardless of whether the buyer ever clicks "received" (D5 has no auto-close, and a request that
 * could wait forever would not satisfy PDPA's own 30-day response expectation).
 */
@Injectable()
export class AccountErasureService {
  private readonly logger = new Logger(AccountErasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditLogService,
    private readonly sessions: SessionService,
    private readonly markers: AccountMarkerService,
    private readonly files: FileStorageService,
    private readonly notifications: NotificationService,
    private readonly shops: ShopService,
  ) {}

  /**
   * Erases the caller's own account right now if nothing is pending, queues the request if an
   * order (as buyer or seller) still is, or refuses outright if the caller still owns an open
   * shop or the account was already erased.
   *
   * Every query below is scoped to `userId`, the same id the guard already proved is the
   * caller's own (I5's own "no second door" discipline, applied here to a person's own data
   * instead of an admin's reach) — this is the self-service entry point, called only through
   * `AccountErasureController` where `@CurrentUser()` supplies that id. `requestErasureAsAdmin`
   * below is the one other entry point into this same flow, added by #74 for the one account
   * that cannot reach this controller at all: a banned one.
   */
  async requestErasure(userId: string): Promise<ErasureRequestResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.erasedAt !== null) {
      throw new AppException('CONFLICT', { message: 'บัญชีนี้ถูกลบไปแล้ว' });
    }

    // K15: never queued — only the owner can close their own shop, so there is nothing for a
    // sweep to wait out here the way there is for an order.
    if (await this.hasOpenShop(userId)) {
      throw new AppException('CONFLICT', {
        message: 'คุณยังมีร้านที่เปิดอยู่ กรุณาปิดร้านก่อนจึงจะขอลบข้อมูลได้',
      });
    }

    return this.finishOrQueue(userId, userId);
  }

  /**
   * #74 (K16, §57/§60): the door §57 found was never reachable — `AuthGuard` refuses every
   * request from a banned account, including `GET /auth/csrf`, so a banned person can never
   * fetch a CSRF token to call `requestErasure` above themselves. This is the door the project
   * owner chose to add instead of loosening that guard (a deliberate default-deny since #24,
   * and a banned account's PDPA rights do not depend on `AuthGuard` letting them through).
   *
   * A super admin calls this **on behalf of** a banned account — everything downstream is
   * identical to the self-service path (same queue-or-erase decision, same
   * `AccountErasureQueueSweepTask` picking up a queued request later) except who is attributed as
   * the actor in `audit_log`. Restricted to accounts that are actually banned: this is a remedy
   * for the one door `AuthGuard` closes, not a shortcut around asking the account holder first
   * for anyone who could still ask themselves.
   *
   * §86 (owner's decisions): K15's open-shop refusal made this door useless for a banned *seller*
   * — the only person who can close the shop is the one who cannot sign in. So this closes it on
   * their behalf, when I11 lets it close at all (`ShopService.closeForErasure`, 409 otherwise). And
   * because the action is irreversible and not the account holder's own click, it needs a reason,
   * recorded as `ACCOUNT_ERASURE_REQUESTED` the moment it is accepted — before §86 a request that
   * only queued left no trace of which admin asked for it, or why.
   */
  async requestErasureAsAdmin(
    actorUserId: string,
    targetUserId: string,
    reason: string,
  ): Promise<ErasureRequestResult> {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (target === null) {
      throw new AppException('NOT_FOUND');
    }

    if (target.bannedAt === null) {
      throw new AppException('CONFLICT', { message: NOT_BANNED_MESSAGE });
    }

    if (target.erasedAt !== null) {
      throw new AppException('CONFLICT', { message: 'บัญชีนี้ถูกลบไปแล้ว' });
    }

    await this.shops.closeForErasure(actorUserId, targetUserId, reason);
    await this.audit.record({
      actorUserId,
      action: 'ACCOUNT_ERASURE_REQUESTED',
      targetType: 'USER',
      targetId: targetUserId,
      reason,
    });

    // §96: "still banned" is checked again under the account's lock (`performErasure`) and rides
    // on the queue write — an unban landing after the check above used to go unnoticed, and the
    // account was erased (or queued as an admin's request) with nothing banned about it (§87).
    return this.finishOrQueue(targetUserId, actorUserId, { requireBanned: true });
  }

  /** K15: whether `userId` still owns an open shop — shared by every path in this service. */
  private async hasOpenShop(userId: string, client: ErasureReader = this.prisma): Promise<boolean> {
    const openShop = await client.shop.findFirst({ where: { ownerId: userId, closedAt: null }, select: { id: true } });

    return openShop !== null;
  }

  /**
   * The queue-or-erase decision shared by `requestErasure` and `requestErasureAsAdmin` — the
   * only difference between the two entry points from this point on is which id `performErasure`
   * attributes the resulting `audit_log` row to.
   */
  private async finishOrQueue(
    targetUserId: string,
    actorUserId: string,
    { requireBanned = false }: { requireBanned?: boolean } = {},
  ): Promise<ErasureRequestResult> {
    const now = this.clock.now();
    // A first look, outside any lock — the common "something is still pending" answer, without
    // opening a transaction for it. Not the decision: see `performErasure`'s own re-check.
    if ((await this.findBlockers(targetUserId, now)).length === 0) {
      const attempt = await this.performErasure(targetUserId, actorUserId, { requireBanned });
      if (attempt === 'NOT_BANNED') {
        throw new AppException('CONFLICT', { message: NOT_BANNED_MESSAGE });
      }
      if (attempt !== 'BLOCKED') {
        return { outcome: 'ERASED' };
      }
      // §84: something appeared between the first look and the lock — an order placed in that
      // window, or (rarely) a shop opened. Falls through to the same answer as if it had been
      // there all along, instead of anonymizing an order a shop still has to ship.
      if (await this.hasOpenShop(targetUserId)) {
        throw new AppException('CONFLICT', { message: 'คุณยังมีร้านที่เปิดอยู่ กรุณาปิดร้านก่อนจึงจะขอลบข้อมูลได้' });
      }
    }

    const blockers = await this.findBlockers(targetUserId, now);
    // Idempotent: a repeat request while already queued keeps the original `requestedAt`
    // (CLAUDE.md's own convention for every conditional `updateMany` in this codebase) rather
    // than resetting the clock on how long this person has been waiting.
    // §87: who asked is recorded with it — an unban withdraws the request only if it was an admin's.
    // Conditional, so whoever queued it first stays on record if two requests cross.
    await this.prisma.user.updateMany({
      where: { id: targetUserId, erasureRequestedAt: null, ...(requireBanned ? { bannedAt: { not: null } } : {}) },
      data: { erasureRequestedAt: now, erasureRequestedBy: actorUserId },
    });
    // §96: the answer is read back from the row, never from what the caller saw before — an unban
    // since then may have lifted the ban and withdrawn an admin's earlier request with it, and
    // "queued" would then be a promise nothing keeps.
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { bannedAt: true, erasureRequestedAt: true },
    });
    // (`erasureRequestedAt` still null is the same case: only an unban clears it, and only an
    // admin's request — a self-service caller cannot be banned and reach this at all.)
    if ((requireBanned && current.bannedAt === null) || current.erasureRequestedAt === null) {
      throw new AppException('CONFLICT', { message: NOT_BANNED_MESSAGE });
    }

    return { outcome: 'QUEUED', requestedAt: current.erasureRequestedAt, blockers };
  }

  /** What the caller's own request looks like right now — H9's "เห็นว่าติดอะไร". */
  async getStatus(userId: string): Promise<ErasureStatusResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.erasedAt !== null) {
      return { status: 'ERASED', erasedAt: user.erasedAt };
    }
    if (user.erasureRequestedAt === null) {
      return { status: 'NONE' };
    }

    const blockers = await this.findBlockers(userId, this.clock.now());
    // §84 (H9: "บอกเหตุผล"): a shop opened after the request was queued holds it up just as much
    // as an order does, but is not an order — before this, the status read `QUEUED` with an empty
    // blocker list and nothing to say why the request never cleared.
    const blockedByOpenShop = await this.hasOpenShop(userId);

    return { status: 'QUEUED', requestedAt: user.erasureRequestedAt, blockers, blockedByOpenShop };
  }

  /**
   * `AccountErasureQueueSweepTask`'s own per-candidate step (H9/H10): re-checks both kinds of
   * block fresh — never trusts anything computed when the request was first queued, because the
   * whole point of a sweep is that the answer can change between passes — and erases if neither
   * still holds. Returns whether it did.
   */
  async tryClearQueuedRequest(userId: string, now: Date): Promise<boolean> {
    // `requestErasure` never queues while a shop is open, but nothing stops a queued person from
    // opening one afterwards (H12 only forbids *two open* shops at once) — `getStatus` reports it.
    if (await this.hasOpenShop(userId)) {
      return false;
    }

    const blockers = await this.findBlockers(userId, now);
    if (blockers.length > 0) {
      return false;
    }

    return (await this.performErasure(userId, userId, { onlyIfStillQueued: true })) === 'ERASED';
  }

  /**
   * Every order still keeping `userId`'s request from clearing, on either side of the trade.
   *
   * §96: not only unfinished orders. An open dispute holds the request up on any order — before,
   * a buyer could dispute a finished order and erase at once (the evidence gone before the ruling,
   * nobody to pay back into if they won), and a seller could do the same from a closed shop. And a
   * seller waits out the buyer's window to open one (owner's decision, §94) — `canOpenDisputeNow`,
   * the same test the dispute door itself applies.
   */
  private async findBlockers(userId: string, now: Date, client: ErasureReader = this.prisma): Promise<ErasureBlocker[]> {
    const orders = await client.order.findMany({
      where: {
        AND: [
          { OR: [{ buyerId: userId }, { shop: { ownerId: userId } }] },
          {
            OR: [
              { status: { in: [...NON_TERMINAL_STATUSES] } },
              { disputes: { some: { closedAt: null } } },
              // Narrowed in SQL to the orders that *might* still be disputable (each window's own
              // upper bound, inclusive like `canOpenDisputeNow`'s own `<=`); that decides exactly.
              { shop: { ownerId: userId }, status: 'COMPLETED', completedAt: { gte: addDays(now, -DISPUTE_WINDOW_AFTER_RECEIVED_DAYS) } },
              { shop: { ownerId: userId }, status: 'CANCELLED', cancelledAt: { gte: addDays(now, -DISPUTE_WINDOW_AFTER_CANCELLED_DAYS) }, paymentSlips: { some: {} } },
            ],
          },
        ],
      },
      select: {
        id: true,
        buyerId: true,
        status: true,
        frozenAt: true,
        shippedAt: true,
        completedAt: true,
        cancelledAt: true,
        frozenDurationSeconds: true,
        disputes: { where: { closedAt: null }, select: { id: true }, take: 1 },
      },
    });

    const blockers: ErasureBlocker[] = [];
    for (const order of orders) {
      const role = order.buyerId === userId ? 'BUYER' : 'SELLER';
      if (order.disputes.length > 0) {
        blockers.push({ orderId: order.id, role, status: order.status, reason: 'OPEN_DISPUTE', clearsAt: null });
        continue;
      }
      if (NON_TERMINAL_STATUSES.includes(order.status)) {
        const clearsAt = clearanceDeadline(order);
        if (clearsAt !== null && clearsAt.getTime() <= now.getTime()) {
          continue; // H10: past its own 15-day cutoff — cleared, does not block.
        }
        blockers.push({ orderId: order.id, role, status: order.status, reason: 'ORDER_IN_PROGRESS', clearsAt });
        continue;
      }
      if (role === 'SELLER' && canOpenDisputeNow(order, now)) {
        blockers.push({ orderId: order.id, role, status: order.status, reason: 'DISPUTE_WINDOW', clearsAt: disputeDeadline(order) });
      }
    }

    return blockers;
  }

  /**
   * The actual anonymizing write, shared by both immediate paths above and the queue sweep.
   *
   * §84: everything that decides *whether* to erase happens here, under a row lock on the account,
   * not only in the callers' earlier look. Before, the blocker check ran outside the transaction,
   * so an order placed in between was anonymized along with everything else (verified: `204`, and
   * an `AWAITING_SHIPPING_QUOTE` order whose recipient and phone were already the placeholders —
   * unshippable, for a buyer who had just been signed out). The lock is the same row
   * `OrderService.checkout` locks for share before it inserts an order, so the two serialize:
   * either the order commits first and is seen here as a blocker (`BLOCKED` — the caller queues),
   * or this commits first and checkout finds the account erased.
   *
   * `bannedAt`/`disputeLostCount`/`email` are read from that same locked row, so a ban landing
   * mid-erasure can no longer be missed by the marker (K16's whole purpose).
   *
   * `actorUserId` defaults to `userId` — the account erasing itself — which is what both the
   * immediate self-service path and the queue sweep's own later clearing want (#74 does not
   * change how a *sweep-cleared* request is attributed, only who is on record for one an admin
   * triggered directly). `requestErasureAsAdmin` is the one caller that passes something else:
   * the super admin who called it, so `audit_log` names who actually acted (invariant 1).
   */
  /**
   * §101: closes an account nobody ever proved — unverified, never connected to Google, not banned —
   * because Google's proven owner of its address has just signed in. The same overwrite as any
   * erasure (sessions and links end, what the account wrote is anonymized, the address is freed),
   * minus the three things that belong to somebody's *own* request: no completion email (it would
   * reach the address's owner seconds after signing in, and read as if their account had gone), no
   * `DeletedAccountMarker` (the address was never anybody's account to leave a trace of) and an audit
   * entry of its own kind. The "unproven" conditions are checked again under the row's lock, so an
   * address verified at the same moment is not closed. Returns whether it was.
   */
  async retireUnproven(userId: string): Promise<boolean> {
    return (await this.performErasure(userId, userId, { retiringUnproven: true })) === 'ERASED';
  }

  private async performErasure(
    userId: string,
    actorUserId: string = userId,
    {
      onlyIfStillQueued = false,
      requireBanned = false,
      retiringUnproven = false,
    }: { onlyIfStillQueued?: boolean; requireBanned?: boolean; retiringUnproven?: boolean } = {},
  ): Promise<ErasureAttempt> {
    const now = this.clock.now();

    // Collected inside the transaction (the rows are about to stop naming anything useful) and
    // acted on afterward — file deletion is disk I/O, the same "never inside the transaction that
    // makes the durable part happen" restraint every notification email in #69 already follows.
    const fileIdsToDelete: string[] = [];
    const pendingChatFileIds: string[] = [];
    let originalEmail = '';

    const attempt = await this.prisma.$transaction(async (tx): Promise<ErasureAttempt> => {
      // FOR UPDATE, unlike every other `user` lock (§114): this rewrites the email, a key column.
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.erasedAt !== null) {
        return 'ALREADY_ERASED';
      }
      // §87: the sweep chose this account from a read without the lock; an unban committed since
      // then withdraws the request (`AdminUsersService.unban` clears it under this same row lock).
      if (onlyIfStillQueued && user.erasureRequestedAt === null) {
        return 'NOT_QUEUED';
      }
      // §96: an admin's erasure rests on the ban (#74) — lifted since the request was accepted, and
      // the account's holder can ask for themselves again.
      if (requireBanned && user.bannedAt === null) {
        return 'NOT_BANNED';
      }
      if (retiringUnproven && (user.emailVerifiedAt !== null || user.googleSubject !== null || user.bannedAt !== null)) {
        return 'NOT_UNPROVEN';
      }
      if ((await this.hasOpenShop(userId, tx)) || (await this.findBlockers(userId, now, tx)).length > 0) {
        return 'BLOCKED';
      }

      originalEmail = user.email;
      const emailHmac = this.markers.hash(user.email);

      await tx.user.update({
        where: { id: userId },
        // §101: Google's id goes with the address — it identifies the person as surely, and left
        // behind it would sign the same person, coming back, into this erased row.
        data: { email: erasedEmailPlaceholder(), passwordHash: null, googleSubject: null, erasedAt: now },
      });
      // §96: every emailed link still outstanding is spent. A reset link sent an hour before used
      // to put a password back on this row after `passwordHash: null` above.
      await tx.verificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });

      // §113 (owner's decision): the account's own notifications go — nobody can sign in to read
      // them again, and some carry an admin's free-text reason about the person. Nothing points at
      // a notification row, so this DELETE is not the kind invariant 5's anonymize rule forbids.
      await tx.notification.deleteMany({ where: { userId } });

      // G3: every Address row for this user, including soft-deleted ones — deliberately no
      // `deletedAt: null` filter here, unlike every read path in this system, because a
      // soft-deleted address is still a row with this person's name and phone number on it.
      await tx.address.updateMany({
        where: { userId },
        data: {
          recipientName: ERASED_NAME_PLACEHOLDER,
          phone: ERASED_PHONE_PLACEHOLDER,
          houseNumber: ERASED_LINE_PLACEHOLDER,
          villageNumber: null,
          alley: null,
          road: null,
        },
      });

      // G3: the address+refund-account snapshot on every order this user has ever bought —
      // invariant 5's one deliberate exception. `postalCode`/`subdistrictName`/etc. are NOT NULL
      // on Order (unlike Address), so these get placeholder text rather than null.
      await tx.order.updateMany({
        where: { buyerId: userId },
        data: {
          recipientName: ERASED_NAME_PLACEHOLDER,
          phone: ERASED_PHONE_PLACEHOLDER,
          houseNumber: ERASED_LINE_PLACEHOLDER,
          villageNumber: null,
          alley: null,
          road: null,
          subdistrictName: ERASED_LINE_PLACEHOLDER,
          districtName: ERASED_LINE_PLACEHOLDER,
          provinceName: ERASED_LINE_PLACEHOLDER,
          postalCode: ERASED_POSTAL_CODE_PLACEHOLDER,
          // L9: the buyer's own refund-receiving account, if an order reached REFUND_ORDERED and
          // it was never wiped by RefundService.confirmReceived (still sitting there because the
          // order hasn't reached REFUNDED — every non-terminal case is already blocked, either
          // outright or by the queue, so this only ever catches a REFUNDED order's leftover).
          refundAccountType: null,
          refundBankName: null,
          refundBankAccountNumber: null,
          refundBankAccountName: null,
          refundPromptPayId: null,
        },
      });

      // The buyer's own payment-slip images — proof of a transfer from their own account.
      const paymentSlips = await tx.paymentSlip.findMany({
        where: { order: { buyerId: userId } },
        select: { fileId: true },
      });
      fileIdsToDelete.push(...paymentSlips.map((slip) => slip.fileId));

      // §84 (project owner, N4): the shop's own *refund* slips are deliberately NOT deleted when the
      // *shop owner* is erased — "สลิปเก่าลบไม่ได้เพราะเป็นหลักฐาน", the buyer's one proof the shop
      // paid them back. §96 (owner's decision): erasing the *buyer* deletes the pictures — they show
      // the buyer's own bank and account number (why L9 wipes the refund-account fields), and the
      // person they were evidence for is the one asking. Rows stay, like payment slips above.
      const refundSlips = await tx.refundSlip.findMany({ where: { order: { buyerId: userId } }, select: { fileId: true } });
      fileIdsToDelete.push(...refundSlips.map((slip) => slip.fileId));

      // K15: every payment channel of every shop this user has owned — bank details and a QR
      // photo are personal data on the owner, not on the shop as an entity (see PaymentChannel's
      // own schema comment).
      const paymentChannels = await tx.paymentChannel.findMany({
        where: { shop: { ownerId: userId } },
        select: { qrImageFileId: true },
      });
      for (const channel of paymentChannels) {
        if (channel.qrImageFileId !== null) {
          fileIdsToDelete.push(channel.qrImageFileId);
        }
      }
      await tx.paymentChannel.updateMany({
        where: { shop: { ownerId: userId } },
        data: { bankName: null, bankAccountNumber: null, bankAccountName: null, promptPayId: null, qrImageFileId: null },
      });

      // N4/N27/#73: every shop this user has ever owned gets its name overwritten and its logo
      // photo queued for deletion — the same treatment #70/#71 already gave payment channels on
      // this line. Reachable even after a shop closed (K15's own reasoning: closing a shop never
      // touches its historical rows), so this is not filtered to `closedAt: null`. §86: a profile
      // change still waiting for review is the owner's own text and photo too — dropped with the
      // rest, and the shop leaves the review queue.
      const shopsToErase = await tx.shop.findMany({
        where: { ownerId: userId },
        select: { id: true, logoFileId: true, pendingLogoFileId: true },
      });
      for (const shop of shopsToErase) {
        for (const fileId of [shop.logoFileId, shop.pendingLogoFileId]) {
          if (fileId !== null) {
            fileIdsToDelete.push(fileId);
          }
        }
      }
      await tx.shop.updateMany({
        where: { ownerId: userId },
        data: {
          name: ERASED_SHOP_NAME_PLACEHOLDER,
          description: null,
          logoFileId: null,
          pendingName: null,
          pendingDescription: null,
          pendingLogoFileId: null,
          profileChangeRequestedAt: null,
        },
      });

      // H8: only this user's own messages, in every room they have ever been a party of — the
      // room and the other party's messages are untouched (ChatMessage.content's own schema
      // comment names this exact write).
      await tx.chatMessage.updateMany({
        where: { senderId: userId },
        data: { content: ERASED_CHAT_MESSAGE_PLACEHOLDER },
      });
      // §89: and every earlier text of the messages they edited — the same person's own words.
      await tx.chatMessageVersion.updateMany({
        where: { message: { senderId: userId } },
        data: { content: ERASED_CHAT_MESSAGE_PLACEHOLDER },
      });
      // §106: their side of the admin↔shop chat, the same way — only what they wrote for the shop.
      // What they wrote as an admin is an admin's official act, kept like a ruling (G3).
      await tx.shopAdminChatMessage.updateMany({
        where: { senderId: userId, senderSide: 'SHOP' },
        data: { content: ERASED_CHAT_MESSAGE_PLACEHOLDER },
      });
      await tx.shopAdminChatMessageVersion.updateMany({
        where: { message: { senderId: userId, senderSide: 'SHOP' } },
        data: { content: ERASED_CHAT_MESSAGE_PLACEHOLDER },
      });

      // §84 — the files K1 lists by name and #70 never reached ("ต้องลบของจริงให้ครบ: สลิป ·
      // หลักฐานข้อพิพาท · รูปรีวิว · ไฟล์แนบแชทของคนนั้น · รูป QR"). Rows stay (they are history:
      // "a picture was here"), bytes go, exactly like a payment slip above. Verified before this:
      // a stranger could still open an erased author's review photo, and the other party of a
      // chat could still open the pictures the erased person had sent.
      const reviewImages = await tx.reviewImage.findMany({ where: { review: { buyerId: userId } }, select: { fileId: true } });
      fileIdsToDelete.push(...reviewImages.map((image) => image.fileId));
      const chatPictures = [
        ...(await tx.chatMessage.findMany({ where: { senderId: userId, fileId: { not: null } }, select: { fileId: true } })),
        // §106: the pictures they sent the admins from the shop's side.
        ...(await tx.shopAdminChatMessage.findMany({ where: { senderId: userId, senderSide: 'SHOP', fileId: { not: null } }, select: { fileId: true } })),
      ];
      for (const message of chatPictures) {
        if (message.fileId !== null) {
          fileIdsToDelete.push(message.fileId);
        }
      }
      const evidence = await tx.disputeEvidence.findMany({ where: { uploadedBy: userId }, select: { fileId: true } });
      fileIdsToDelete.push(...evidence.map((item) => item.fileId));

      // §83's unsent chat uploads have no history to keep — the row only ever meant "waiting to be
      // sent" — so both it and its `uploaded_file` row go, the same as the 24-hour sweep does.
      const pending = await tx.chatPendingAttachment.findMany({ where: { uploaderId: userId }, select: { fileId: true } });
      pendingChatFileIds.push(...pending.map((row) => row.fileId));
      await tx.chatPendingAttachment.deleteMany({ where: { uploaderId: userId } });
      const pendingForAdmins = await tx.shopAdminChatPendingAttachment.findMany({ where: { uploaderId: userId }, select: { fileId: true } });
      pendingChatFileIds.push(...pendingForAdmins.map((row) => row.fileId));
      await tx.shopAdminChatPendingAttachment.deleteMany({ where: { uploaderId: userId } });

      // §84 (project owner's choice): the free text this person wrote in a dispute — H8's rule for
      // chat applied here too. The admin's ruling is kept (G3).
      await tx.dispute.updateMany({ where: { openedBy: userId }, data: { reason: ERASED_DISPUTE_TEXT_PLACEHOLDER } });
      await tx.dispute.updateMany({
        where: { shop: { ownerId: userId }, shopResponse: { not: null } },
        data: { shopResponse: ERASED_DISPUTE_TEXT_PLACEHOLDER },
      });

      // §96 (owner's decision): the rest of the free text this person typed as a buyer — H8's rule,
      // extended the way §84 extended it to disputes. The review stays and its stars still count;
      // a shop's or the system's cancel reason is not the buyer's words and stays.
      await tx.review.updateMany({ where: { buyerId: userId, text: { not: null } }, data: { text: ERASED_BUYER_TEXT_PLACEHOLDER } });
      await tx.order.updateMany({
        where: { buyerId: userId, cancelledBy: 'BUYER', cancelReason: { not: null } },
        data: { cancelReason: ERASED_BUYER_TEXT_PLACEHOLDER },
      });
      await tx.shippingFeeRejection.updateMany({ where: { order: { buyerId: userId } }, data: { reason: ERASED_BUYER_TEXT_PLACEHOLDER } });

      // K16: the one row that lets #29's registration guard keep a banned person from coming back
      // through a fresh signup. §84: an upsert, merged — K16 lets an erased-but-never-banned
      // address sign up again, and that second account can be erased too; a plain insert collided
      // with the first erasure's row on `emailHmac`'s unique key and answered 500 every time.
      // Merged conservatively: ever banned stays banned, and dispute losses add up (a new account
      // starts from 0 by K16, so the sum is the address's whole record).
      // §101: not for an unproven account being retired — the address was never anybody's account.
      if (!retiringUnproven) {
        await tx.deletedAccountMarker.upsert({
          where: { emailHmac },
          create: { id: newId(), emailHmac, deletedAt: now, wasBanned: user.bannedAt !== null, disputeLostCount: user.disputeLostCount },
          update: {
            deletedAt: now,
            disputeLostCount: { increment: user.disputeLostCount },
            ...(user.bannedAt !== null ? { wasBanned: true } : {}),
          },
        });
      }

      // §112 (the owner's decision): an erased account administers nothing — it can never sign in
      // again, and its rows kept it on every admin list while the community's queue paged no one.
      const adminRows = await tx.communityAdmin.findMany({ where: { userId }, select: { communityId: true }, orderBy: { communityId: 'asc' } });
      await tx.communityAdmin.deleteMany({ where: { userId } });
      for (const { communityId } of adminRows) {
        await this.audit.record(communityAdminGrantEntry(actorUserId, 'COMMUNITY_ADMIN_REVOKED', userId, communityId), tx);
      }

      await this.audit.record(
        { actorUserId, action: retiringUnproven ? 'UNPROVEN_ACCOUNT_RETIRED' : 'ACCOUNT_ERASED', targetType: 'USER', targetId: userId },
        tx,
      );

      return 'ERASED';
    });

    if (attempt !== 'ERASED') {
      return attempt;
    }

    // I16's own mechanism, reused rather than reimplemented: every session this account holds,
    // across every device, stops working from this instant — not merely "the browser is told to
    // forget its cookies" (the controller does that too, but only for the browser that asked).
    // §84: no longer the only wall — `SessionService` refuses an erased account's session outright,
    // so a crash between the commit above and this line cannot leave a session working.
    await this.sessions.revokeAllForUser(userId);

    // Disk I/O, after commit. §84: one file failing no longer stops the rest — before, the first
    // failure threw out of this loop, skipped every file after it and the completion notice, and
    // answered 500 on an erasure that had already committed; `erasedAt` then kept anything from
    // ever coming back for those bytes. Each failure is logged by file id (never content) so it
    // can be removed by hand.
    for (const fileId of fileIdsToDelete) {
      await this.deleteQuietly(fileId, () => this.files.deleteBytes(fileId));
    }
    for (const fileId of pendingChatFileIds) {
      await this.deleteQuietly(fileId, () => this.files.discardUnattached(fileId));
    }

    if (retiringUnproven) {
      return 'ERASED';
    }

    // #71 (H9/I17): the one notification this whole feature was always going to end with, whether
    // it fired immediately (nothing was ever queued) or only now, once the queue finally cleared.
    // Must carry the address captured above, from before this same transaction overwrote it —
    // `notify`'s own DB lookup would otherwise find the placeholder this method just wrote.
    await this.notifications.notify(
      { userId, type: 'ACCOUNT_ERASURE_COMPLETED', message: 'บัญชีของคุณถูกลบข้อมูลตาม PDPA เรียบร้อยแล้ว' },
      {
        subject: 'ลบข้อมูลบัญชีของคุณเรียบร้อยแล้ว',
        body: 'คำขอลบข้อมูลตาม PDPA ของคุณเสร็จสมบูรณ์แล้ว ข้อมูลส่วนบุคคลของคุณถูกเขียนทับทุกจุดตามที่แจ้งไว้',
        recipientEmail: originalEmail,
      },
    );

    return 'ERASED';
  }

  private async deleteQuietly(fileId: string, remove: () => Promise<void>): Promise<void> {
    try {
      await remove();
    } catch (error) {
      this.logger.error(`Erasure could not delete file ${fileId}; remove it by hand`, error instanceof Error ? error.stack : String(error));
    }
  }
}

/** The columns H10's own cutoff needs — a subset of `Order`. */
interface ClearanceWindowOrder {
  status: OrderStatus;
  frozenAt: Date | null;
  shippedAt: Date | null;
  frozenDurationSeconds: number;
}

/**
 * H10: the point a single non-terminal order stops blocking an erasure request on its own — 15
 * days after `shippedAt` (D5b's own number, reused rather than a second one invented for this
 * ticket), shifted out by time the order spent frozen, the same adjustment `disputeDeadline`
 * applies for the same reason (see that function's own comment). `null` for anything that is not
 * a currently-unfrozen `SHIPPED` order: those all still need someone to actually act (pay, confirm
 * receipt of payment, send a refund) before they can be considered done, so there is no fixed date
 * to compute — "ยังไม่ถึงส่งแล้ว (ยังอยู่เรือน 1–3) หรือถูกแช่แข็ง → คำขอยังค้าง ไม่ลบ" (this ticket's
 * own AC), and `REFUND_ORDERED` for the same reason (K15: a shop that still owes a refund is not
 * "safe to forget", however long ago it shipped).
 */
function clearanceDeadline(order: ClearanceWindowOrder): Date | null {
  if (order.status !== 'SHIPPED' || order.frozenAt !== null || order.shippedAt === null) {
    return null;
  }

  return addSeconds(addDays(order.shippedAt, DISPUTE_WINDOW_AFTER_SHIPPED_DAYS), order.frozenDurationSeconds);
}
