import { Injectable } from '@nestjs/common';
import { Order, OrderStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception.js';
import { newId } from '../../common/id.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../../files/file-storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { PaymentSlipDto } from '../dto/payment-slip.dto.js';

/** E1/K4: a slip only ever lands while there is something to pay and nothing decided yet. */
const UPLOADABLE_STATUSES: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'PAYMENT_SUBMITTED'];

/**
 * `PaymentSlip` (#54, E1/I3): the buyer's own evidence trail for one order. Every upload is a
 * new row — see the model's own schema comment for why a single `slipUrl` column was ruled out —
 * and every row stays forever, rejected or not.
 *
 * Deliberately does not depend on `OrderService`: the order-status checks here are the same
 * shape `OrderService`'s own methods already do directly against `PrismaService` (a `findFirst`
 * scoped to the caller, a conditional `updateMany`), not a shared abstraction — introducing one
 * for two callers would be the kind of indirection CLAUDE.md's own smell list calls out.
 */
@Injectable()
export class PaymentSlipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    private readonly clock: Clock,
  ) {}

  /**
   * Only the order's own buyer may upload (E1: "รับสลิปในหน้าออเดอร์เท่านั้น" — this is that one
   * page, never chat). The first slip of the order moves `AWAITING_PAYMENT` → `PAYMENT_SUBMITTED`
   * in the same transaction as the row insert; a second, third, ... slip while already
   * `PAYMENT_SUBMITTED` just adds another row — I3's "อัปทับได้" without ever touching `status`
   * again. Anything else (before a shipping quote, after the shop confirmed, cancelled, frozen)
   * is refused — re-uploading cannot resurrect a decided order.
   *
   * #57 (I3b): that same `AWAITING_PAYMENT` → `PAYMENT_SUBMITTED` transition is also the only
   * place `paymentConfirmationWindowStartedAt` is ever written — clock 3 counts from "the first
   * slip of the *current* round", and this branch only ever runs on the first slip of a round by
   * construction: a second upload while already `PAYMENT_SUBMITTED` skips it entirely (I3: "อัป
   * สลิปทับไม่รีเซ็ตเรือน 3"), and a round only restarts by leaving `PAYMENT_SUBMITTED` first —
   * #56's reject sends the order back to `AWAITING_PAYMENT`, so the *next* upload lands in this
   * same branch again and correctly overwrites the stale timestamp from the round that just ended.
   * `paymentConfirmationWarningSentAt` is cleared alongside it for the same reason `paymentWarningSentAt`
   * is cleared on reject — a new round gets its own untouched 24h-left warning.
   */
  /**
   * The buyer's own order, in a state that takes a slip. Also asked by the upload route before the
   * file is read (§100, `@AcceptsUpload`), so a slip for an order that could never take one is
   * refused before it costs anything.
   */
  async requireSlipUploadable(buyerId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.frozenAt !== null) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ถูกแช่แข็งอยู่ อัปสลิปไม่ได้ตอนนี้' });
    }
    if (!UPLOADABLE_STATUSES.includes(order.status)) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอโอนเงินแล้ว อัปสลิปไม่ได้' });
    }
    return order;
  }

  async upload(buyerId: string, orderId: string, upload: UploadedTempFile): Promise<PaymentSlipDto> {
    const order = await this.requireSlipUploadable(buyerId, orderId);

    const stored = await this.files.storeDocument(upload);
    const now = this.clock.now();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // §82: the status (and freeze) check above ran before `storeDocument`, which re-encodes
        // the file and can take hundreds of milliseconds — plenty of time for the shop to confirm
        // payment, or an admin to freeze the order, in between. Both branches therefore re-assert
        // the order's state as the condition of a write, inside this transaction: the first slip
        // of a round with the status move it already makes, every later slip with a no-op touch of
        // `updatedAt` whose only job is that condition (and the row lock that comes with it, which
        // queues this behind a concurrent `confirmPayment` instead of racing it). Before this, a
        // re-upload landing mid-confirm was answered 201 and attached to an order already PAID —
        // against #54's "อัปสลิปหลังร้านยืนยันแล้ว → ถูกปฏิเสธ".
        const result =
          order.status === 'AWAITING_PAYMENT'
            ? await tx.order.updateMany({
                where: { id: order.id, status: 'AWAITING_PAYMENT', frozenAt: null },
                data: {
                  status: 'PAYMENT_SUBMITTED',
                  paymentConfirmationWindowStartedAt: now,
                  paymentConfirmationWarningSentAt: null,
                  updatedAt: now,
                },
              })
            : await tx.order.updateMany({
                where: { id: order.id, status: 'PAYMENT_SUBMITTED', frozenAt: null },
                data: { updatedAt: now },
              });
        if (result.count === 0) {
          throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอโอนเงินแล้ว อัปสลิปไม่ได้' });
        }

        return tx.paymentSlip.create({
          data: { id: newId(), orderId: order.id, fileId: stored.id, createdAt: now },
        });
      });

      return PaymentSlipDto.from(created);
    } catch (error) {
      // Nothing points at the stored file now that the transaction rolled back (§82).
      await this.files.discardUnattached(stored.id);
      throw error;
    }
  }

  /** Every slip on the order, oldest first — the shop sees all of them, not just the latest (เรื่องที่ 6). */
  async list(actorUserId: string, orderId: string): Promise<PaymentSlipDto[]> {
    await this.requireParty(actorUserId, orderId);

    const rows = await this.prisma.paymentSlip.findMany({
      where: { orderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => PaymentSlipDto.from(row));
  }

  /**
   * The slip's raw bytes. I5: a community admin never reaches this, not even for a frozen order
   * — break-glass has exactly one door (the dispute path, topic 10), not this one. The check
   * here is only ever "is the caller this order's buyer or its shop's owner", which by
   * construction already excludes every admin role.
   */
  async readFile(actorUserId: string, orderId: string, slipId: string): Promise<ReadImage> {
    await this.requireParty(actorUserId, orderId);

    const slip = await this.prisma.paymentSlip.findFirst({ where: { id: slipId, orderId } });
    if (slip === null) {
      throw new AppException('NOT_FOUND');
    }

    const file = await this.files.readStoredFile(slip.fileId);
    if (file === null) {
      // Unreachable in practice — nothing deletes an UploadedFile row once a PaymentSlip points
      // at it — but answering NOT_FOUND rather than a 500 costs nothing and stays honest if that
      // ever stops being true (same reasoning PaymentChannelService.readQrImage uses).
      throw new AppException('NOT_FOUND');
    }

    return file;
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
