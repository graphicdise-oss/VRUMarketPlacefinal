import { Injectable } from '@nestjs/common';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * I7: fires when a frozen order that had already cut real stock (#55 — reached `PAID`) is
 * terminated (#62) instead of released. The system deliberately does not restore the stock
 * itself — it has no way to know whether the goods actually made it back to the shop — so this
 * is the shop's own cue to go check and adjust manually. Same shape as `OrderReceivedNotificationPort`
 * and for the same reason: the channel (an in-app row, maybe an email) is topic 12's decision,
 * not this ticket's — this lets `FrozenOrderService` detect the event and call one thing, with
 * topic 12 swapping in the real implementation later without this ticket's code changing at all.
 */
export abstract class OrderStockAdjustmentPort {
  abstract notify(orderId: string): Promise<void>;
}

/** #69: notifies the shop owner, in-app only — I7's table row carries no email. */
@Injectable()
export class NotifyingOrderStockAdjustmentPort extends OrderStockAdjustmentPort {
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
      type: 'ORDER_STOCK_ADJUST_NEEDED',
      message: 'ออเดอร์นี้ถูกยุติหลังตัดสต็อกไปแล้ว กรุณาตรวจสอบและปรับสต็อกสินค้าด้วยตัวเอง',
      targetType: 'ORDER',
      targetId: orderId,
    });
  }
}
