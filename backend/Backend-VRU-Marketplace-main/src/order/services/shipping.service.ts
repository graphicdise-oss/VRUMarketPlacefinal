import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception.js';
import { newId } from '../../common/id.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../../files/file-storage.service.js';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { OrderDto } from '../dto/order.dto.js';
import { ShipOrderDto } from '../dto/ship-order.dto.js';
import { ShippingSlipDto } from '../dto/shipping-slip.dto.js';
import { UpdateTrackingNumberDto } from '../dto/update-tracking-number.dto.js';
import { ORDER_INCLUDE, ownedByShopOwner } from './order.service.js';

/**
 * `Order.shippedAt`/`trackingNumber` + `TrackingNumberChange` (#58, F1/I15): the shop's side of
 * topic 9. Split out of `OrderService` the same way `PaymentSlipService` was — a different table
 * of its own (`TrackingNumberChange`), and a different actor's action (only ever the shop owner),
 * are enough reason for a service of its own rather than growing `OrderService` further.
 */
@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
    private readonly files: FileStorageService,
  ) {}

  /**
   * F1: reachable only from `PAID` — a shop cannot ship before the buyer's transfer is confirmed,
   * and cannot ship twice (`shippedAt` is written once, here, and nowhere else). `carrierNameOther`
   * is validated against the *row* `shippingCarrierId` names, not the DTO shape alone (K9): required
   * when that row is the "อื่นๆ" catch-all, and rejected otherwise, so a real carrier never ends up
   * with a confusing free-text label sitting next to it.
   *
   * Deliberately does not check `frozenAt` or `shop.suspendedAt` — the same "finish what's already
   * committed" reasoning `OrderService.confirmPayment`/`rejectSlip` already carry in full (J2's own
   * AC names this exact action: "ร้านที่ถูกระงับยังกดส่งได้"), and shipping an already-paid order is
   * not the kind of unilateral ending `cancel` blocks while frozen.
   */
  async ship(ownerId: string, orderId: string, dto: ShipOrderDto): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...ownedByShopOwner(ownerId) } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.status !== 'PAID') {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ยังไม่ถึงขั้นตอนที่ส่งของได้ หรือถูกส่งไปแล้ว' });
    }

    const carrier = await this.prisma.shippingCarrier.findFirst({
      where: { id: dto.shippingCarrierId, isActive: true },
    });
    if (carrier === null) {
      throw new AppException('VALIDATION_FAILED', {
        fieldErrors: { shippingCarrierId: 'กรุณาเลือกบริษัทขนส่งจากรายการ' },
      });
    }
    if (carrier.isOther && dto.carrierNameOther === undefined) {
      throw new AppException('VALIDATION_FAILED', {
        fieldErrors: { carrierNameOther: 'กรุณาระบุชื่อบริษัทขนส่ง' },
      });
    }
    if (!carrier.isOther && dto.carrierNameOther !== undefined) {
      throw new AppException('VALIDATION_FAILED', {
        fieldErrors: { carrierNameOther: 'ระบุชื่อขนส่งเองได้เฉพาะตอนเลือก "อื่นๆ" เท่านั้น' },
      });
    }

    const now = this.clock.now();
    const result = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'PAID' },
      data: {
        status: 'SHIPPED',
        shippedAt: now,
        shippingCarrierId: carrier.id,
        carrierNameOther: carrier.isOther ? (dto.carrierNameOther ?? null) : null,
        // §85 (invariant 5): the name as it reads today, kept — a later rename of the carrier row
        // must not rewrite what this order says it was sent with.
        shippingCarrierNameAtShipment: carrier.name,
        trackingNumber: dto.trackingNumber,
        updatedAt: now,
      },
    });
    if (result.count === 0) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ยังไม่ถึงขั้นตอนที่ส่งของได้ หรือถูกส่งไปแล้ว' });
    }

    // #69: in-app only — the tracking number itself is on the order page, not repeated here.
    await this.notifications.notify({
      userId: order.buyerId,
      type: 'ORDER_SHIPPED',
      message: 'ร้านส่งของแล้ว ดูเลขพัสดุได้ที่หน้าออเดอร์',
      targetType: 'ORDER',
      targetId: order.id,
    });

    const updated = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });

    return OrderDto.from(updated);
  }

  /**
   * I15: corrects a tracking number typed in wrong, any number of times, each one kept in
   * `TrackingNumberChange` rather than overwritten in place. Gated on `status: 'SHIPPED'`, re-read
   * under the row lock — once #59's "mark received" moves an order past that (to `COMPLETED`),
   * this refuses, which is what makes evidence on a closed order stay put (this ticket's own AC:
   * "หลังกดรับของ → ถูกปฏิเสธ").
   *
   * Same "does not check frozenAt/shop.suspendedAt" reasoning as `ship` above — J2 names this
   * exact action too ("ร้านที่ถูกระงับยังแก้เลขพัสดุได้").
   */
  async updateTrackingNumber(ownerId: string, orderId: string, dto: UpdateTrackingNumberDto): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...ownedByShopOwner(ownerId) }, select: { id: true, status: true } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.status !== 'SHIPPED') {
      throw new AppException('CONFLICT', { message: TRACKING_NOT_EDITABLE });
    }

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      // §85: lock the order row before reading the number being replaced. A plain read inside the
      // transaction was not enough under READ COMMITTED — three edits sent together all read the
      // same old number and each recorded a change *from* it, leaving the history with gaps.
      await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${order.id}::uuid FOR UPDATE`;
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { id: true, status: true, trackingNumber: true } });
      if (current.status !== 'SHIPPED' || current.trackingNumber === null) {
        throw new AppException('CONFLICT', { message: TRACKING_NOT_EDITABLE });
      }

      if (current.trackingNumber !== dto.trackingNumber) {
        await tx.trackingNumberChange.create({
          data: {
            id: newId(),
            orderId: current.id,
            previousTrackingNumber: current.trackingNumber,
            newTrackingNumber: dto.trackingNumber,
            changedBy: ownerId,
            changedAt: now,
          },
        });
      }

      await tx.order.update({ where: { id: current.id }, data: { trackingNumber: dto.trackingNumber, updatedAt: now } });

      return tx.order.findUniqueOrThrow({ where: { id: current.id }, include: ORDER_INCLUDE });
    });

    return OrderDto.from(updated);
  }

  /**
   * Check order can take a shipping slip upload (status PAID or SHIPPED).
   * Used as @AcceptsUpload precheck.
   */
  async requireShippableOrShipped(ownerId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...ownedByShopOwner(ownerId) } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.status !== 'PAID' && order.status !== 'SHIPPED') {
      throw new AppException('CONFLICT', { message: 'อัปโหลดสลิปส่งของได้เฉพาะสถานะชำระเงินแล้ว หรือจัดส่งแล้วเท่านั้น' });
    }
    return order;
  }

  /**
   * Upload shipping slip (postal receipt / courier dispatch slip).
   */
  async uploadSlip(ownerId: string, orderId: string, upload: UploadedTempFile): Promise<ShippingSlipDto> {
    const order = await this.requireShippableOrShipped(ownerId, orderId);

    const stored = await this.files.storeDocument(upload);
    const now = this.clock.now();

    try {
      const created = await this.prisma.shippingSlip.create({
        data: {
          id: newId(),
          orderId: order.id,
          fileId: stored.id,
          createdAt: now,
        },
      });

      return ShippingSlipDto.from(created);
    } catch (error) {
      await this.files.discardUnattached(stored.id);
      throw error;
    }
  }

  /**
   * List all shipping slips for an order, oldest first.
   */
  async listSlips(actorUserId: string, orderId: string): Promise<ShippingSlipDto[]> {
    await this.requireParty(actorUserId, orderId);

    const rows = await this.prisma.shippingSlip.findMany({
      where: { orderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => ShippingSlipDto.from(row));
  }

  /**
   * Read raw bytes of shipping slip file.
   */
  async readSlipFile(actorUserId: string, orderId: string, slipId: string): Promise<ReadImage> {
    await this.requireParty(actorUserId, orderId);

    const slip = await this.prisma.shippingSlip.findFirst({ where: { id: slipId, orderId } });
    if (slip === null) {
      throw new AppException('NOT_FOUND');
    }

    const file = await this.files.readStoredFile(slip.fileId);
    if (file === null) {
      throw new AppException('NOT_FOUND');
    }

    return file;
  }

  /** Buyer of the order, or owner of the shop it was placed against. */
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

const TRACKING_NOT_EDITABLE = 'แก้เลขพัสดุได้เฉพาะออเดอร์ที่ส่งแล้วและผู้ซื้อยังไม่กดรับของ';
