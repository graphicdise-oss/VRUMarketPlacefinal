import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuditLogService } from '../../audit/audit-log.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { keysetAfter, newestFirst } from '../../common/pagination/keyset.js';
import { Page, toPage } from '../../common/pagination/page.js';
import { communityFilterFor, inCommunities, refuseOwnCase } from '../../community/community-admin-scope.js';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { STOCK_CUT_STATUSES, UNPAID_STATUSES } from '../common/order-status-sets.js';
import { FrozenOrderAdminDto, FrozenOrderQueueItemDto } from '../dto/frozen-order-admin.dto.js';
import { RuleFrozenOrderDto } from '../dto/rule-frozen-order.dto.js';
import { OrderStockAdjustmentPort } from '../ports/order-stock-adjustment.port.js';
import { OrderFreezeService } from './order-freeze.service.js';

/**
 * #62: the community-admin side of a frozen order — the masked read (I5) and the one decision
 * (I4) an admin may make about it. A separate service from `OrderService` on purpose: that
 * service builds `OrderDto`, which carries the buyer's name/address/phone directly on the row
 * (invariant 5's snapshot) — reusing it here would mean remembering, forever, to keep masking it
 * out at every call site instead of this service never having read those columns in the first
 * place.
 */
@Injectable()
export class FrozenOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditLogService,
    private readonly orderFreeze: OrderFreezeService,
    private readonly stockAdjustment: OrderStockAdjustmentPort,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * I5: the guard (`@RequiresCommunityAdmin(OrderIdScopeResolver)`) already proved the caller
   * administers this order's shop's community, or is super admin. Readable whether or not the
   * order is currently frozen — an admin reviewing what happened after a ruling needs the same
   * masked shape, and there is no privacy reason to take it away once unfrozen.
   */
  async adminView(orderId: string): Promise<FrozenOrderAdminDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: MASKED_ORDER_SELECT });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }

    return FrozenOrderAdminDto.from(order);
  }

  /**
   * §102: the frozen orders waiting on this caller — the same scoping as every other admin queue
   * (`communityFilterFor`: every community for a super admin, their own for a community admin, an
   * empty page for anyone else), newest first. Leaves out the caller's own cases: they cannot rule
   * on them (N28), so they are somebody else's work.
   */
  async queue(actorUserId: string, role: UserRole, limit: number, cursor: string | undefined): Promise<Page<FrozenOrderQueueItemDto>> {
    const communityFilter = await communityFilterFor(this.prisma, actorUserId, role);
    if (communityFilter === 'none') {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.order.findMany({
      where: {
        ...keysetAfter(cursor, FROZEN_QUEUE_LIST_NAME),
        frozenAt: { not: null },
        buyerId: { not: actorUserId },
        shop: { ownerId: { not: actorUserId }, ...inCommunities(communityFilter) },
      },
      orderBy: newestFirst(),
      take: limit + 1,
      select: { ...MASKED_ORDER_SELECT, shop: { select: { communityId: true } }, disputes: { where: AWAITING_RULING, select: { id: true } } },
    });
    const page = toPage(rows, limit, FROZEN_QUEUE_LIST_NAME);

    return { ...page, items: page.items.map((row) => FrozenOrderQueueItemDto.fromQueueRow(row)) };
  }

  /**
   * I4: release restores exactly where the order was (H3, via `OrderFreezeService.forceUnfreeze`
   * — every stacked reason is cleared at once, an admin's judgment call overriding the automatic
   * bookkeeping). Terminate lets **the system** pick the destination from H5's own line — never
   * the caller, which is what `RuleFrozenOrderDto` having no destination field already enforces at
   * the validation layer: no slip up (`UNPAID_STATUSES`) → cancelled; a slip up or already paid →
   * `REFUND_ORDERED`; already `REFUND_ORDERED` → stays there, only released.
   *
   * §85, three corrections:
   *
   * - `PAYMENT_SUBMITTED` now goes to `REFUND_ORDERED`, not `CANCELLED` — I4 in as many words:
   *   "อัปสลิปแล้ว → REFUND_ORDERED". The buyer has transferred; cancelling left them no refund path.
   * - The status that decides is re-read under the order's row lock, inside the transaction. A
   *   shop may confirm payment on a frozen order (J2); deciding on a read taken before the lock let
   *   a TERMINATE that raced a confirmation cancel an order the shop had just been paid for.
   * - An admin who is the order's buyer or its shop's owner cannot rule on it (N28).
   *
   * I7: terminating an order that had already cut real stock fires `OrderStockAdjustmentPort` —
   * outside the transaction, the same "the durable part already committed" reasoning
   * `AdminUsersService.ban`'s session revocation uses. A terminated order's buyer and shop are
   * both told how it ended (`ORDER_TERMINATED`) — the shop may now owe a refund.
   */
  async rule(actorUserId: string, orderId: string, dto: RuleFrozenOrderDto): Promise<void> {
    const seen = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, frozenAt: true, buyerId: true, shop: { select: { ownerId: true } } },
    });
    if (seen === null) {
      throw new AppException('NOT_FOUND');
    }
    refuseOwnCase(actorUserId, { buyerId: seen.buyerId, shopOwnerId: seen.shop.ownerId });
    if (seen.frozenAt === null) {
      throw new AppException('CONFLICT', { message: NOT_FROZEN });
    }

    const now = this.clock.now();
    const reason = `[${dto.verdict}] ${dto.reason}`;
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, frozenAt: true, buyerId: true, shop: { select: { ownerId: true, communityId: true } } },
      });
      if (order.frozenAt === null) {
        throw new AppException('CONFLICT', { message: NOT_FROZEN });
      }
      // §102 (J3): a dispute still waiting for its ruling decides this order, and that ruling
      // releases the freeze itself. A TERMINATE here used to send the order to REFUND_ORDERED, where
      // a later SHOP_WINS left it — the shop owing a refund on a dispute it won. Only an *unruled*
      // one: a BUYER_WINS dispute stays open through the refund loop but decides nothing more, and an
      // order frozen after that ruling had no other way out (review). Read under the order's lock,
      // which opening a dispute (and ruling one) also takes, so neither can slip in between.
      const awaitingRuling = await tx.dispute.findFirst({ where: { orderId, ...AWAITING_RULING }, select: { id: true } });
      if (awaitingRuling !== null) {
        throw new AppException('CONFLICT', { message: DECIDED_BY_DISPUTE });
      }

      let destination: 'RELEASED' | 'CANCELLED' | 'REFUND_ORDERED' = 'RELEASED';
      let stockWasCut = false;
      if (dto.verdict === 'TERMINATE') {
        if (UNPAID_STATUSES.includes(order.status)) {
          // Cancel outright, same as any other cancellation — StockReservationService's own
          // status join releases the reservation for free the moment status leaves its set.
          destination = 'CANCELLED';
          await tx.order.update({
            where: { id: orderId },
            data: {
              status: 'CANCELLED',
              cancelledBy: 'ADMIN',
              cancelReason: 'แอดมินตัดสินให้ยุติออเดอร์นี้หลังถูกแช่แข็ง (ยังไม่มีเงินเปลี่ยนมือ)',
              cancelledAt: now,
              updatedAt: now,
            },
          });
        } else if (order.status !== 'REFUND_ORDERED') {
          destination = 'REFUND_ORDERED';
          stockWasCut = STOCK_CUT_STATUSES.includes(order.status);
          await tx.order.update({ where: { id: orderId }, data: { status: 'REFUND_ORDERED', refundOrderedAt: now, updatedAt: now } });
        } else {
          // Already REFUND_ORDERED (frozen for an unrelated reason while already headed there) —
          // no status change, and no I7 notice: the stock may never have been cut (I1's path).
          destination = 'REFUND_ORDERED';
        }
      }

      await this.orderFreeze.forceUnfreeze(tx, actorUserId, orderId, now, { reason, notifyBuyer: dto.verdict === 'RELEASE' });
      await this.audit.record(
        { actorUserId, action: 'FROZEN_ORDER_RULED', targetType: 'ORDER', targetId: orderId, reason, communityId: order.shop.communityId },
        tx,
      );

      return { destination, stockWasCut, buyerId: order.buyerId, shopOwnerId: order.shop.ownerId };
    });

    if (outcome.stockWasCut) {
      await this.stockAdjustment.notify(orderId);
    }
    if (outcome.destination !== 'RELEASED') {
      const message =
        outcome.destination === 'CANCELLED'
          ? 'แอดมินตัดสินให้ยุติออเดอร์นี้ ออเดอร์ถูกยกเลิกแล้ว'
          : 'แอดมินตัดสินให้ยุติออเดอร์นี้ ร้านต้องคืนเงินให้ผู้ซื้อตามขั้นตอนคืนเงิน';
      for (const userId of [outcome.buyerId, outcome.shopOwnerId]) {
        await this.notifications.notify({ userId, type: 'ORDER_TERMINATED', message, targetType: 'ORDER', targetId: orderId });
      }
    }
  }
}

/** Everything `FrozenOrderAdminDto` shows and nothing more — no name, address, phone or slip file (I5). */
const MASKED_ORDER_SELECT = {
  id: true,
  shopId: true,
  status: true,
  frozenAt: true,
  totalAmountMinor: true,
  shippingAmountMinor: true,
  currency: true,
  items: { select: { productNameAtPurchase: true, variantNameAtPurchase: true, priceAtPurchase: true, currency: true, quantity: true } },
  freezeReasons: { select: { reason: true } },
  _count: { select: { paymentSlips: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderSelect;

const FROZEN_QUEUE_LIST_NAME = 'frozenOrdersQueue';

/** A dispute that still decides its order (J3): open, and not ruled yet. */
const AWAITING_RULING = { closedAt: null, verdict: null } satisfies Prisma.DisputeWhereInput;

const NOT_FROZEN = 'ออเดอร์นี้ไม่ได้ถูกแช่แข็งอยู่';
const DECIDED_BY_DISPUTE = 'ออเดอร์นี้มีข้อพิพาทเปิดอยู่ ให้ตัดสินผ่านข้อพิพาท คำตัดสินจะปลดการแช่แข็งให้เอง';
