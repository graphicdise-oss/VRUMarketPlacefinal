import { Injectable } from '@nestjs/common';
import { DisputeVerdict, Prisma, UserRole } from '@prisma/client';
import { AuditLogService } from '../../audit/audit-log.service.js';
import { CaseParties, communityFilterFor, inCommunities, refuseOwnCase, refuseOwnCaseAccess } from '../../community/community-admin-scope.js';
import { keysetAfter, newestFirst } from '../../common/pagination/keyset.js';
import { Page, toPage } from '../../common/pagination/page.js';
import { AppException } from '../../common/errors/app-exception.js';
import { FileStorageService, ReadImage } from '../../files/file-storage.service.js';
import { PaymentSlipDto } from '../../order/dto/payment-slip.dto.js';
import { OrderDto } from '../../order/dto/order.dto.js';
import { OrderFreezeService } from '../../order/services/order-freeze.service.js';
import { OrderStockAdjustmentPort } from '../../order/ports/order-stock-adjustment.port.js';
import { ORDER_INCLUDE } from '../../order/services/order.service.js';
import { STOCK_CUT_STATUSES } from '../../order/common/order-status-sets.js';
import { lockAccountRow } from '../../common/live-account-lock.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { DisputeRulingNotificationPort } from '../ports/dispute-ruling-notification.port.js';
import { DisputeAdminDto } from '../dto/dispute-admin.dto.js';
import { DisputeBreakGlassDto } from '../dto/dispute-break-glass.dto.js';
import { DisputeDto } from '../dto/dispute.dto.js';
import { RevealIdentityDto } from '../dto/reveal-identity.dto.js';
import { RuleDisputeDto } from '../dto/rule-dispute.dto.js';

const DISPUTE_INCLUDE = {
  evidence: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.DisputeInclude;

/**
 * `Dispute` + `DisputeEvidence` (#63/#64): opening, responding, ruling (K12), a super admin's
 * override (I9b), and the one break-glass door into an order's PII while its dispute is open
 * (I5). K13's "one OPEN dispute at a time" is enforced twice — a friendly pre-check here, and the
 * partial unique index (`dispute_one_open_per_order_key`) as the real guarantee under a race.
 */
@Injectable()
export class DisputeAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    private readonly clock: Clock,
    private readonly audit: AuditLogService,
    private readonly orderFreeze: OrderFreezeService,
    private readonly rulingNotifications: DisputeRulingNotificationPort,
    private readonly stockAdjustment: OrderStockAdjustmentPort,
  ) {}

  /**
   * K12/I6: the one ruling a community admin (or super admin) may make on an OPEN dispute —
   * `BUYER_WINS` moves the order to `REFUND_ORDERED` unconditionally (D5b lets a dispute reach
   * back from `COMPLETED`, so this is a real forward transition, not only from `PAID`/`SHIPPED`)
   * and costs the shop's *owner* a `disputeLostCount` (I12 — never `Shop`, see that column's own
   * reasoning). `SHOP_WINS` touches `Order.status` not at all — free from I6's own flag model.
   *
   * 🚨 Only `SHOP_WINS` closes the dispute here. `BUYER_WINS` deliberately leaves `closedAt`
   * null: the ruling didn't resolve anything by itself, it started #65's refund loop, and H7's
   * own AC calls out closing this dispute as *that* ticket's job — "H7 คือสิ่งที่ตัดสิทธิ์เห็น
   * PII ของแอดมิน (#64)" only makes sense if ruling itself didn't already revoke it. See
   * `Dispute.closedAt`'s own schema comment for the full reasoning and `RefundService`
   * (#65)'s `confirmReceived`/the H7 sweep task for the two places that actually close it.
   * Guarded on `dispute.verdict !== null` rather than `closedAt !== null` for exactly this
   * reason — a `BUYER_WINS` ruling is still "already ruled" even while its dispute row stays
   * open through the refund loop.
   *
   * Either verdict releases any freeze on the order (J3 — "คำตัดสินปลดการแช่แข็งของใบนั้นไปในตัว"),
   * and fires I7's stock-adjustment notice if real stock had already been cut. Refuses outright
   * on a dispute already ruled — that is what `override` (super admin only) exists for.
   *
   * §85: the "not ruled yet" check rides on the write itself (two admins ruling at once used to
   * both succeed — two audit entries, `disputeLostCount` up by two); the order's status is read
   * under its row lock; an admin who is a party to the order cannot rule (N28); and BUYER_WINS
   * goes through `orderRefund`, which restarts the refund loop on an order already mid-refund.
   */
  async rule(actorUserId: string, disputeId: string, dto: RuleDisputeDto): Promise<DisputeDto> {
    const theCase = await this.loadCase(disputeId);
    refuseOwnCase(actorUserId, theCase);
    if (theCase.dispute.verdict !== null) {
      throw new AppException('CONFLICT', { message: ALREADY_RULED });
    }
    // §87 (owner's decision): a dispute that closed without a ruling — the buyer confirmed the
    // refund while it was open (`markRefunded`) — is over. Ruling it afterwards counted a loss
    // against a shop that had already paid back. Only a ruled dispute is reopened, by override (I9).
    if (theCase.dispute.closedAt !== null) {
      throw new AppException('CONFLICT', { message: CLOSED_WITHOUT_RULING });
    }

    const now = this.clock.now();
    const verdict = dto.verdict;

    const stockWasCut = await this.prisma.$transaction(async (tx) => {
      // §91 (review): the shop owner's row before the order — user → order is the lock order a
      // ban follows (it freezes the owner's orders after writing the owner).
      // §95: and both before the dispute row. The shop's answer holds the owner's row and then
      // writes the dispute, and `markRefunded` holds the order and then closes the dispute; claiming
      // the dispute first here made each of them a deadlock (user → order → dispute everywhere).
      if (verdict === 'BUYER_WINS') {
        await lockAccountRow(tx, theCase.shopOwnerId);
      }
      const order = await this.lockOrder(tx, theCase.dispute.orderId);

      const claimed = await tx.dispute.updateMany({
        where: { id: disputeId, verdict: null, closedAt: null },
        data: {
          verdict,
          rulingReason: dto.reason,
          ruledBy: actorUserId,
          ruledAt: now,
          updatedAt: now,
          ...(verdict === 'SHOP_WINS' ? { closedAt: now } : {}),
        },
      });
      if (claimed.count === 0) {
        throw new AppException('CONFLICT', { message: ALREADY_RULED });
      }

      let cut = false;
      if (verdict === 'BUYER_WINS') {
        cut = await this.orderRefund(tx, order, now);
        await tx.user.update({ where: { id: theCase.shopOwnerId }, data: { disputeLostCount: { increment: 1 } } });
      }
      // SHOP_WINS: Order.status is never touched — I6's flag model gives this for free.

      if (order.frozenAt !== null) {
        await this.orderFreeze.forceUnfreeze(tx, actorUserId, order.id, now, { reason: `[DISPUTE_RULED ${verdict}] ${dto.reason}`, notifyBuyer: verdict === 'SHOP_WINS' });
      }

      await this.audit.record(
        { actorUserId, action: 'DISPUTE_RULED', targetType: 'DISPUTE', targetId: disputeId, reason: `[${verdict}] ${dto.reason}`, communityId: theCase.communityId },
        tx,
      );

      return cut;
    });

    if (stockWasCut) {
      await this.stockAdjustment.notify(theCase.dispute.orderId);
    }
    await this.rulingNotifications.notify(disputeId);

    const updated = await this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: DISPUTE_INCLUDE });

    return DisputeDto.from(updated);
  }

  /**
   * I9b: super admin only (enforced by the controller's `@RequiresSuperAdmin()`, not the
   * community guard — "แอดมินชุมชนกลับคำตัดสินของตัวเองไม่ได้"). Overwrites the ruling in place
   * — `verdict`/`rulingReason`/`ruledBy`/`ruledAt` change, `closedAt` does not, in either
   * direction: `closedAt` tracks the refund loop's real-world progress (#65), not which verdict
   * currently stands, so an override never touches it. Concretely: overriding `SHOP_WINS` (closed
   * immediately at ruling) to `BUYER_WINS` does **not** reopen the dispute or restart a refund
   * loop that was never started — `Order.status` isn't touched either (see below), so there is
   * nothing for a loop to track. Overriding `BUYER_WINS` (open, mid-refund-loop or already closed
   * by H6/H7) to `SHOP_WINS` does **not** force-close it either — the loop, if still running,
   * keeps running on its own regardless of which verdict is now on record; nothing here is a
   * shortcut around it.
   *
   * 🚨 Deliberately never touches `Order.status`. The first ruling's consequences (money already
   * asked for, stock already flagged for the shop to check) are real-world events this platform
   * cannot undo any more than I7 lets it un-cut stock — the same "never claim to reverse what
   * already happened outside the system" restraint invariant 2 already enforces for money itself.
   * What an override *can* safely correct is `User.disputeLostCount` — a reputation counter with
   * no external consequence — so it adjusts that by exactly the one step the corrected verdict
   * implies (+1 moving to `BUYER_WINS`, -1 moving away from it), never resetting it outright.
   *
   * §85 (owner's decision, replacing the above for one direction): moving *to* `BUYER_WINS` now
   * really orders the refund — `orderRefund`, the same thing a first BUYER_WINS ruling does —
   * because a verdict that says "the buyer is owed" but orders nothing is not a verdict. Moving
   * *away* from it still leaves the loop running (the money may already have moved), but waives
   * K11's penalty (`refundPenaltyWaivedAt`) — the corrected ruling says no refund was owed. The
   * verdict is re-read under the dispute's row lock, so two identical overrides at once move the
   * counter one step (§95: that lock is now the last of three, after the owner and the order).
   *
   * §102 (owner's decision, replacing "closedAt does not change" above for one case): an override
   * to BUYER_WINS of a dispute SHOP_WINS had closed reopens it — see `reopenForRefundLoop`.
   */
  async override(actorUserId: string, disputeId: string, dto: RuleDisputeDto): Promise<DisputeDto> {
    const theCase = await this.loadCase(disputeId);
    refuseOwnCase(actorUserId, theCase);
    if (theCase.dispute.verdict === null) {
      throw new AppException('CONFLICT', { message: 'ข้อพิพาทนี้ยังไม่มีคำตัดสินให้กลับ' });
    }

    const now = this.clock.now();
    const newVerdict = dto.verdict;

    const stockWasCut = await this.prisma.$transaction(async (tx) => {
      // §95: user → order → dispute, the order every other path takes (see `rule`). Both are taken
      // even when the verdict turns out unchanged — which one it is can only be read under the
      // dispute's lock, and that lock has to come last.
      await lockAccountRow(tx, theCase.shopOwnerId);
      const order = await this.lockOrder(tx, theCase.dispute.orderId);
      await tx.$queryRaw`SELECT id FROM dispute WHERE id = ${disputeId}::uuid FOR UPDATE`;
      const current = await tx.dispute.findUniqueOrThrow({ where: { id: disputeId }, select: { verdict: true, closedAt: true } });
      const oldVerdict: DisputeVerdict | null = current.verdict;
      if (oldVerdict === null) {
        throw new AppException('CONFLICT', { message: 'ข้อพิพาทนี้ยังไม่มีคำตัดสินให้กลับ' });
      }

      await tx.dispute.update({
        where: { id: disputeId },
        data: { verdict: newVerdict, rulingReason: dto.reason, ruledBy: actorUserId, ruledAt: now, updatedAt: now },
      });

      let cut = false;
      if (newVerdict !== oldVerdict) {
        const delta = newVerdict === 'BUYER_WINS' ? 1 : -1;
        await tx.user.update({ where: { id: theCase.shopOwnerId }, data: { disputeLostCount: { increment: delta } } });

        if (newVerdict === 'BUYER_WINS') {
          cut = await this.orderRefund(tx, order, now);
          await this.reopenForRefundLoop(tx, disputeId, current.closedAt, order, now);
        } else if (order.status === 'REFUND_ORDERED') {
          await tx.order.update({ where: { id: order.id }, data: { refundPenaltyWaivedAt: now, updatedAt: now } });
        }
      }

      await this.audit.record(
        {
          actorUserId,
          action: 'DISPUTE_RULING_OVERRIDDEN',
          targetType: 'DISPUTE',
          targetId: disputeId,
          reason: `[${oldVerdict} -> ${newVerdict}] ${dto.reason}`,
          communityId: theCase.communityId,
        },
        tx,
      );

      return cut;
    });

    if (stockWasCut) {
      await this.stockAdjustment.notify(theCase.dispute.orderId);
    }
    await this.rulingNotifications.notify(disputeId);

    const updated = await this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: DISPUTE_INCLUDE });

    return DisputeDto.from(updated);
  }

  /**
   * What "the buyer wins" does to the order (K12), shared by a first ruling and an override to
   * BUYER_WINS (§85). Answers whether real stock had been cut, for I7's notice.
   *
   * - Not yet in the refund loop → `REFUND_ORDERED`, K11's clock starting now (D5b lets a dispute
   *   reach back from `COMPLETED`, so this is a real forward transition from any of them).
   * - Already `REFUND_ORDERED` with a refund slip up → the loop **restarts** (§85, owner's
   *   decision): the ruling says the refund did not really arrive, so the old slip stops counting,
   *   the buyer may correct their account again (L9), and K11/H7 start over. Without a slip yet,
   *   nothing restarts — the shop is still inside the same obligation.
   * - `REFUNDED` → unchanged: the loop already closed (a new dispute cannot be opened there, §85;
   *   this only matters for an override of an older ruling).
   */
  private async orderRefund(tx: Prisma.TransactionClient, order: LockedOrder, now: Date): Promise<boolean> {
    if (order.status === 'REFUNDED') {
      return false;
    }
    if (order.status === 'REFUND_ORDERED') {
      await tx.order.update({
        where: { id: order.id },
        data:
          order.refundSlipFirstUploadedAt === null
            ? { refundPenaltyWaivedAt: null, updatedAt: now }
            : {
                refundOrderedAt: now,
                refundSlipFirstUploadedAt: null,
                refundConfirmWindowStartedAt: null,
                refundOverdueFlaggedAt: null,
                refundPenaltyWaivedAt: null,
                updatedAt: now,
              },
      });
      return false;
    }

    await tx.order.update({ where: { id: order.id }, data: { status: 'REFUND_ORDERED', refundOrderedAt: now, refundPenaltyWaivedAt: null, updatedAt: now } });

    return STOCK_CUT_STATUSES.includes(order.status);
  }

  /**
   * §102: an override to BUYER_WINS of a dispute SHOP_WINS had closed starts a refund loop
   * (`orderRefund`) — and reopens the dispute for it, the way a first BUYER_WINS ruling leaves its
   * dispute open: the loop's end (`markRefunded`, H7) is what closes it, and until then the admin
   * can follow it (break-glass, the chat). Before, the loop ran on a closed dispute nobody could see.
   *
   * Not when the order's refund already completed (nothing would ever close it again), and not
   * when another dispute on the order is open — only one may be (K13), and that one already gives
   * the admin the same access. Both read under the order's lock, which opening a dispute also takes.
   */
  private async reopenForRefundLoop(tx: Prisma.TransactionClient, disputeId: string, closedAt: Date | null, order: LockedOrder, now: Date): Promise<void> {
    if (closedAt === null || order.status === 'REFUNDED') {
      return;
    }
    const anotherOpen = await tx.dispute.count({ where: { orderId: order.id, closedAt: null, id: { not: disputeId } } });
    if (anotherOpen > 0) {
      return;
    }

    await tx.dispute.update({ where: { id: disputeId }, data: { closedAt: null, updatedAt: now } });
  }

  /** The order row under `SELECT ... FOR UPDATE`, with what a ruling needs to decide on. */
  private async lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<LockedOrder> {
    await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${orderId}::uuid FOR UPDATE`;

    return tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, status: true, frozenAt: true, refundSlipFirstUploadedAt: true } });
  }

  /** The dispute, its two parties (N28's `refuseOwnCase`), and its shop's community (every admin audit entry, §75). */
  private async loadCase(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { order: { select: { buyerId: true } }, shop: { select: { ownerId: true, communityId: true } } },
    });
    if (dispute === null) {
      throw new AppException('NOT_FOUND');
    }

    return { dispute, buyerId: dispute.order.buyerId, shopOwnerId: dispute.shop.ownerId, communityId: dispute.shop.communityId };
  }


  /**
   * I5's one break-glass door: the exact same full shape the order's own buyer/shop see, plus
   * the slip list — readable only while a dispute on this order is OPEN, checked fresh every
   * call (never a flag cached anywhere), and only by this dispute's shop's community admin or
   * super admin (the controller's guard). `DISPUTE_IDENTITY_REVEALED` requires the reason
   * `RevealIdentityDto` carries — the only record of why this admin needed to see it, since I9
   * leaves no appeal to check their work against later.
   */
  async breakGlass(actorUserId: string, disputeId: string, dto: RevealIdentityDto): Promise<DisputeBreakGlassDto> {
    const dispute = await this.requireOpenForAdmin(actorUserId, disputeId);

    const [order, slips] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id: dispute.orderId }, include: ORDER_INCLUDE }),
      this.prisma.paymentSlip.findMany({ where: { orderId: dispute.orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]);

    await this.audit.record({
      actorUserId,
      action: 'DISPUTE_IDENTITY_REVEALED',
      targetType: 'DISPUTE',
      targetId: disputeId,
      reason: dto.reason,
      communityId: dispute.communityId,
    });

    return DisputeBreakGlassDto.from(OrderDto.from(order), slips.map((slip) => PaymentSlipDto.from(slip)));
  }

  /** One slip's raw bytes under break-glass — same live-open check, its own audit entry and reason. */
  async breakGlassSlipFile(actorUserId: string, disputeId: string, slipId: string, dto: RevealIdentityDto): Promise<ReadImage> {
    const dispute = await this.requireOpenForAdmin(actorUserId, disputeId);

    const slip = await this.prisma.paymentSlip.findFirst({ where: { id: slipId, orderId: dispute.orderId } });
    if (slip === null) {
      throw new AppException('NOT_FOUND');
    }

    const file = await this.files.readStoredFile(slip.fileId);
    if (file === null) {
      throw new AppException('NOT_FOUND');
    }

    await this.audit.record({
      actorUserId,
      action: 'DISPUTE_IDENTITY_REVEALED',
      targetType: 'DISPUTE',
      targetId: disputeId,
      reason: dto.reason,
      communityId: dispute.communityId,
    });

    return file;
  }

  /**
   * A community admin's (or super admin's) read of one piece of dispute evidence — gated by the
   * controller's guard, not a reason: this is case evidence for whoever is judging the dispute,
   * not PII, so it carries none of break-glass's reveal ceremony. Still only while the dispute is
   * open — an admin outside this community-and-open window has no route here at all.
   *
   * §85: audited (`DISPUTE_EVIDENCE_VIEWED`) — evidence photos can carry a parcel label or a
   * face, and invariant 1 has every admin action reach the log, the same as a chat view.
   */
  async readEvidenceAsAdmin(actorUserId: string, disputeId: string, evidenceId: string): Promise<ReadImage> {
    const dispute = await this.requireOpenForAdmin(actorUserId, disputeId);

    const evidence = await this.prisma.disputeEvidence.findFirst({ where: { id: evidenceId, disputeId } });
    if (evidence === null) {
      throw new AppException('NOT_FOUND');
    }

    const file = await this.files.readImage(evidence.fileId);
    if (file === null) {
      throw new AppException('NOT_FOUND');
    }

    await this.audit.record({ actorUserId, action: 'DISPUTE_EVIDENCE_VIEWED', targetType: 'DISPUTE', targetId: disputeId, communityId: dispute.communityId });

    return file;
  }

  /**
   * #64's own reusable answer to "is this order's chat currently break-glass-visible" — the one
   * condition topic 11's chat guard is instructed to call through here rather than reimplement
   * (its own AC names this exact method). Live every time, never a cached flag.
   */
  async isOrderUnderOpenDisputeBreakGlass(orderId: string): Promise<boolean> {
    const openDispute = await this.prisma.dispute.findFirst({ where: { orderId, closedAt: null }, select: { id: true } });

    return openDispute !== null;
  }

  /**
   * §102: the open disputes waiting on this caller — scoped like every other admin queue
   * (`communityFilterFor`), newest first, each with the chat room between its parties. Leaves out
   * the caller's own cases (N28): they cannot rule on them.
   */
  async queue(actorUserId: string, role: UserRole, limit: number, cursor: string | undefined): Promise<Page<DisputeAdminDto>> {
    const communityFilter = await communityFilterFor(this.prisma, actorUserId, role);
    if (communityFilter === 'none') {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.dispute.findMany({
      where: {
        ...keysetAfter(cursor, OPEN_DISPUTES_LIST_NAME),
        closedAt: null,
        order: { buyerId: { not: actorUserId } },
        shop: { ownerId: { not: actorUserId }, ...inCommunities(communityFilter) },
      },
      orderBy: newestFirst(),
      take: limit + 1,
      include: ADMIN_CASE_INCLUDE,
    });
    const page = toPage(rows, limit, OPEN_DISPUTES_LIST_NAME);
    const rooms = await this.chatRoomsOf(page.items.map((row) => ({ buyerId: row.order.buyerId, shopOwnerId: row.shop.ownerId })));

    return {
      ...page,
      items: page.items.map((row) => DisputeAdminDto.fromCase(row, rooms.get(pairKey({ buyerId: row.order.buyerId, shopOwnerId: row.shop.ownerId })) ?? null)),
    };
  }

  /**
   * §102: one dispute as its admin sees it — open only, like the evidence and break-glass (I5), and
   * not by one of its parties. The guard already proved the community.
   *
   * §103 (owner's decision): audited as `DISPUTE_VIEWED`, after the read succeeds — it shows what
   * the parties typed, which can carry a name or a phone number. The queue stays unaudited.
   */
  async adminView(actorUserId: string, disputeId: string): Promise<DisputeAdminDto> {
    const dispute = await this.requireOpenForAdmin(actorUserId, disputeId);
    const row = await this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: ADMIN_CASE_INCLUDE });
    const parties = { buyerId: row.order.buyerId, shopOwnerId: row.shop.ownerId };
    const rooms = await this.chatRoomsOf([parties]);

    await this.audit.record({ actorUserId, action: 'DISPUTE_VIEWED', targetType: 'DISPUTE', targetId: disputeId, communityId: dispute.communityId });

    return DisputeAdminDto.fromCase(row, rooms.get(pairKey(parties)) ?? null);
  }

  /** The chat room of each (buyer, shop owner) pair that has one — one query for a whole page. */
  private async chatRoomsOf(pairs: readonly CaseParties[]): Promise<Map<string, string>> {
    if (pairs.length === 0) {
      return new Map();
    }
    const rooms = await this.prisma.chatRoom.findMany({
      where: { OR: pairs.map((pair) => ({ buyerId: pair.buyerId, shopOwnerUserId: pair.shopOwnerId })) },
      select: { id: true, buyerId: true, shopOwnerUserId: true },
    });

    return new Map(rooms.map((room) => [pairKey({ buyerId: room.buyerId, shopOwnerId: room.shopOwnerUserId }), room.id]));
  }

  private async requireOpenForAdmin(actorUserId: string, disputeId: string): Promise<{ id: string; orderId: string; communityId: string }> {
    const found = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: { id: true, orderId: true, closedAt: true, order: { select: { buyerId: true } }, shop: { select: { communityId: true, ownerId: true } } },
    });
    if (found === null || found.closedAt !== null) {
      // 🚨 Closed → not found, not forbidden (I5's own AC: "ปิดเรื่อง → เห็นไม่ได้ทันที") — this
      // is what makes the live re-check real instead of a permission the guard already granted
      // once and this method would otherwise just honor forever.
      throw new AppException('NOT_FOUND');
    }
    // §102: not through the admin door into a case the caller is a party to (N28, for reads).
    refuseOwnCaseAccess(actorUserId, { buyerId: found.order.buyerId, shopOwnerId: found.shop.ownerId });

    return { id: found.id, orderId: found.orderId, communityId: found.shop.communityId };
  }
}

const ALREADY_RULED = 'ข้อพิพาทนี้ถูกตัดสินไปแล้ว';
const CLOSED_WITHOUT_RULING = 'ข้อพิพาทนี้ปิดไปแล้วโดยไม่ต้องตัดสิน (ผู้ซื้อยืนยันว่าได้รับเงินคืนแล้ว)';
const OPEN_DISPUTES_LIST_NAME = 'disputesOpenQueue';

/** What the admin view of a dispute needs beyond the parties' own: its shop's community, and both parties for the chat room. */
const ADMIN_CASE_INCLUDE = {
  ...DISPUTE_INCLUDE,
  order: { select: { buyerId: true } },
  shop: { select: { communityId: true, ownerId: true } },
} satisfies Prisma.DisputeInclude;

function pairKey(pair: CaseParties): string {
  return `${pair.buyerId}:${pair.shopOwnerId}`;
}

type LockedOrder = Pick<Prisma.OrderGetPayload<object>, 'id' | 'status' | 'frozenAt' | 'refundSlipFirstUploadedAt'>;

