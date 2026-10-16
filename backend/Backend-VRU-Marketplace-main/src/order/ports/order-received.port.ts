import { Injectable } from '@nestjs/common';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Where "the buyer marked this order received" goes once it happens (#59) — the same shape as
 * `OrderDeadlineWarningPort` and for the same reason: this ticket's own AC says "ยิงเหตุการณ์ออกไป
 * ให้หัวข้อ 12 แจ้งเตือนร้าน" and "ใบนี้ไม่ส่งอีเมลเอง" — the channel (in-app row, and whether it's
 * also worth an email) is topic 12's decision, not this ticket's. An abstract class lets
 * `OrderService.markReceived` detect the event and call one thing, while topic 12 swaps in the
 * real implementation later without this ticket's code changing at all.
 */
export abstract class OrderReceivedNotificationPort {
  abstract notify(orderId: string): Promise<void>;
}

/** #69: notifies the shop owner, in-app only — not one of I17's email-worthy events. */
@Injectable()
export class NotifyingOrderReceivedNotificationPort extends OrderReceivedNotificationPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {
    super();
  }

  async notify(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { shop: { select: { ownerId: true } } } });
    if (order === null) {
      return;
    }

    await this.notifications.notify({
      userId: order.shop.ownerId,
      type: 'ORDER_RECEIVED',
      message: 'ผู้ซื้อกดยืนยันว่าได้รับสินค้าแล้วสำหรับออเดอร์นี้',
      targetType: 'ORDER',
      targetId: orderId,
    });
  }
}
