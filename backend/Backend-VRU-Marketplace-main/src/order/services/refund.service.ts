import { Injectable } from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception.js';
import { newId } from '../../common/id.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../../files/file-storage.service.js';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { markRefunded } from '../common/refund-transition.js';
import { OrderDto } from '../dto/order.dto.js';
import { RefundAccountDto } from '../dto/refund-account.dto.js';
import { RefundSlipDto } from '../dto/refund-slip.dto.js';
import { ORDER_INCLUDE, ownedByShopOwner } from './order.service.js';

const NOT_AWAITING_REFUND = 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอคืนเงิน';

/**
 * #65: the closed loop after an order reaches `REFUND_ORDERED` — the buyer's own receiving
 * account (L9), the shop's proof of sending it back (K11), and the buyer's own confirmation that
 * closes the loop (H6). The H7 auto-close half of that same loop is a sweep task
 * (`RefundBuyerConfirmExpirySweepTask` in `order-sweep.tasks.ts`), not a method here — it has no
 * caller-driven trigger, so it has no business on a service other things call directly.
 *
 * Deliberately does not depend on `OrderService`, the same restraint `PaymentSlipService`
 * documents on itself: the order-status checks here are the same shape that service's own
 * methods already do directly against `PrismaService`.
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * L9: only while `REFUND_ORDERED`, only the order's own buyer, and blocked the instant a
   * refund slip lands — by then the shop may already have sent money to whatever account was on
   * file, so changing it afterward would be misleading rather than a correction. Frozen blocks it
   * too, the same restraint every other buyer-initiated action on a frozen order already follows
   * (`PaymentSlipService.upload`, `OrderService.markReceived`) — unlike the shop's own refund-slip
   * upload below, which J2/invariant 7 deliberately keeps open even while frozen or suspended.
   * Resubmitting before a slip exists simply overwrites — not locked like `Order.shippingAmountMinor`
   * (H1), since a typo here has no analogous "buyer might already be paying a different amount" risk.
   */
  async submitAccount(buyerId: string, orderId: string, dto: RefundAccountDto): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.frozenAt !== null) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ถูกแช่แข็งอยู่ กรอกบัญชีรับเงินคืนไม่ได้' });
    }
    if (order.status !== 'REFUND_ORDERED') {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอคืนเงิน' });
    }
    if (order.refundSlipFirstUploadedAt !== null) {
      throw new AppException('CONFLICT', { message: 'ร้านอัปสลิปคืนเงินไปแล้ว แก้บัญชีรับเงินคืนไม่ได้อีก' });
    }

    const now = this.clock.now();
    const data: Prisma.OrderUpdateInput = { refundAccountType: dto.type, updatedAt: now };
    if (dto.type === 'BANK_TRANSFER') {
      data.refundBankName = dto.bankName;
      data.refundBankAccountNumber = dto.bankAccountNumber;
      data.refundBankAccountName = dto.bankAccountName;
      data.refundPromptPayId = null;
    } else {
      data.refundPromptPayId = dto.promptPayId;
      data.refundBankName = null;
      data.refundBankAccountNumber = null;
      data.refundBankAccountName = null;
    }

    const result = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'REFUND_ORDERED', frozenAt: null, refundSlipFirstUploadedAt: null },
      data,
    });
    if (result.count === 0) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอคืนเงิน หรือร้านอัปสลิปไปแล้ว' });
    }

    const updated = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });

    return OrderDto.from(updated);
  }

  /**
   * K11: the shop's own proof it sent the money back. Not blocked by a frozen order or a
   * suspended shop (J2/invariant 7 — "ร้านที่ถูกสั่งคืนเงินจะคืนไม่ได้จริง" is exactly the failure
   * mode those invariants exist to prevent), the same restraint `OrderService.confirmPayment` and
   * `ShippingService.ship` already document on themselves. The first slip on an order also starts
   * H7's own 7-day buyer-confirm clock (`refundSlipFirstUploadedAt`); every slip after that just
   * adds another row, the same "อัปทับได้" shape `PaymentSlipService.upload` already established.
   */
  /**
   * An order of the caller's shop that is waiting for its refund. Also asked by the upload route
   * before the file is read (§100, `@AcceptsUpload`).
   */
  async requireAwaitingRefund(ownerId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...ownedByShopOwner(ownerId) } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.status !== 'REFUND_ORDERED') {
      throw new AppException('CONFLICT', { message: NOT_AWAITING_REFUND });
    }
    return order;
  }

  async uploadSlip(ownerId: string, orderId: string, upload: UploadedTempFile): Promise<RefundSlipDto> {
    const order = await this.requireAwaitingRefund(ownerId, orderId);

    const stored = await this.files.storeDocument(upload);
    const now = this.clock.now();

    const created = await this.prisma
      .$transaction(async (tx) => {
        // §85: re-checked under the order's row lock, next to the insert — a slip landing just
        // after the buyer confirmed (REFUNDED) used to be accepted, and emailed about.
        await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${order.id}::uuid FOR UPDATE`;
        const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, refundSlipFirstUploadedAt: true } });
        if (current.status !== 'REFUND_ORDERED') {
          throw new AppException('CONFLICT', { message: NOT_AWAITING_REFUND });
        }

        const slip = await tx.refundSlip.create({
          data: { id: newId(), orderId: order.id, fileId: stored.id, createdAt: now },
        });

        // The first slip of this refund loop starts H7's clock. "Of this loop": a BUYER_WINS ruling
        // on an order already mid-refund clears both columns to start the loop over (§85).
        if (current.refundSlipFirstUploadedAt === null) {
          await tx.order.update({
            where: { id: order.id },
            data: { refundSlipFirstUploadedAt: now, refundConfirmWindowStartedAt: now, updatedAt: now },
          });
        }

        return slip;
      })
      .catch(async (error: unknown) => {
        await this.files.discardUnattached(stored.id);
        throw error;
      });

    // #69 (I17): one of the events with a matching email — the buyer is owed money and should not
    // have to keep reopening the order page to notice a slip landed. Every slip fires this, not
    // only the first — H7's own 7-day "confirm receipt" clock only starts on the first (see that
    // column's comment), but the buyer is worth telling about each one regardless.
    await this.notifications.notify(
      {
        userId: order.buyerId,
        type: 'REFUND_SLIP_UPLOADED',
        message: 'ร้านอัปโหลดสลิปคืนเงินแล้ว กรุณาตรวจสอบยอดเงินในบัญชีของคุณ',
        targetType: 'ORDER',
        targetId: order.id,
      },
      { subject: 'ร้านอัปสลิปคืนเงินแล้ว', body: 'ร้านอัปโหลดสลิปคืนเงินแล้ว กรุณาตรวจสอบยอดเงินในบัญชีของคุณ' },
    );

    return RefundSlipDto.from(created);
  }

  /** Every refund slip on the order, oldest first — the buyer sees all of them, same as payment slips. */
  async listSlips(actorUserId: string, orderId: string): Promise<RefundSlipDto[]> {
    await this.requireParty(actorUserId, orderId);

    const rows = await this.prisma.refundSlip.findMany({
      where: { orderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => RefundSlipDto.from(row));
  }

  /** The slip's raw bytes. Same I5 restraint as `PaymentSlipService.readFile` — no admin route here at all. */
  async readSlipFile(actorUserId: string, orderId: string, slipId: string): Promise<ReadImage> {
    await this.requireParty(actorUserId, orderId);

    const slip = await this.prisma.refundSlip.findFirst({ where: { id: slipId, orderId } });
    if (slip === null) {
      throw new AppException('NOT_FOUND');
    }

    const file = await this.files.readStoredFile(slip.fileId);
    if (file === null) {
      throw new AppException('NOT_FOUND');
    }

    return file;
  }

  /**
   * H6: only the order's own buyer may ever call this — not the shop, not an admin (I6's own
   * reasoning: nobody else can actually know the money arrived). Refused while frozen, the same
   * restraint `OrderService.markReceived` already follows. Requires at least one refund slip to
   * exist first — confirming receipt of something the shop never claimed to have sent is not a
   * real confirmation. Reaches `REFUNDED` (I8) and wipes the now-unneeded receiving account (L9),
   * and closes any dispute still open on this order in the same breath — the thing that actually
   * revokes a community admin's break-glass access (see `Dispute.closedAt`'s own schema comment).
   */
  async confirmReceived(buyerId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.frozenAt !== null) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ถูกแช่แข็งอยู่ ยืนยันรับเงินคืนไม่ได้ตอนนี้' });
    }
    if (order.status !== 'REFUND_ORDERED') {
      throw new AppException('CONFLICT', { message: NOT_AWAITING_REFUND });
    }
    // §85: a slip *of this refund loop* — after a BUYER_WINS ruling restarts the loop, the old
    // slips still exist as evidence but no longer count as the shop having sent anything.
    if (order.refundSlipFirstUploadedAt === null) {
      throw new AppException('CONFLICT', { message: 'ร้านยังไม่ได้อัปสลิปคืนเงิน ยืนยันรับเงินคืนไม่ได้' });
    }

    const now = this.clock.now();
    const refunded = await this.prisma.$transaction((tx) =>
      markRefunded(tx, order.id, { status: 'REFUND_ORDERED', frozenAt: null, refundSlipFirstUploadedAt: { not: null } }, now),
    );
    if (!refunded) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอคืนเงิน หรือถูกแช่แข็งอยู่' });
    }

    const updated = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });

    return OrderDto.from(updated);
  }

  /** Buyer of the order, or the owner of the shop it was placed against — nobody else, ever. */
  private async requireParty(actorUserId: string, orderId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, OR: [{ buyerId: actorUserId }, { shop: { ownerId: actorUserId } }] },
      select: { id: true },
    });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
  }
}
