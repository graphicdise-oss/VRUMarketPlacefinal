import { Injectable } from '@nestjs/common';
import { NotificationType } from '../../notification/notification-type.js';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Which of the three clocks (invariant 3) a warning is about. */
export type OrderDeadlineWarningKind = 'SHIPPING_QUOTE' | 'PAYMENT' | 'PAYMENT_CONFIRMATION';

/**
 * Where a warning goes once a clock crosses its "about to expire" threshold (I17).
 *
 * #53's own AC is explicit that this ticket "ยิงเหตุการณ์ออกไป" (fires the event) and
 * "ช่องทางแจ้งเตือนเป็นของหัวข้อ 12" (the channel belongs to topic 12) — "ใบนี้ไม่ส่งอีเมลเอง" (this
 * ticket does not send email itself). Per DECISIONS §「ช่องทาง Notification」, every notification
 * is an in-app `Notification` row *always*, with email (through the `EmailSender` interface —
 * `DEADLINE_WARNING` has been a reserved `EmailKind` since #19) only for time-sensitive ones like
 * this. Calling `EmailSender` directly from here would build only the email half and leave the
 * in-app row for topic 12 to somehow bolt on separately. An abstract class, the same shape as
 * `EmailSender` itself, lets #53 detect the crossing and call one thing, while topic 12 swaps in
 * the real implementation that writes the `Notification` row and decides whether to also email.
 */
export abstract class OrderDeadlineWarningPort {
  abstract warn(orderId: string, kind: OrderDeadlineWarningKind): Promise<void>;
}

/**
 * #69: the real implementation — an in-app `Notification` always, plus a `DEADLINE_WARNING`
 * email (I17). The recipient differs by clock: clock 2 (PAYMENT) is the buyer's own deadline to
 * transfer; clocks 1 and 3 (SHIPPING_QUOTE, PAYMENT_CONFIRMATION) are the shop's own deadlines to
 * quote shipping and confirm receipt — see spec 12/12's own user stories 2 and 3.
 */
@Injectable()
export class NotifyingOrderDeadlineWarningPort extends OrderDeadlineWarningPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {
    super();
  }

  async warn(orderId: string, kind: OrderDeadlineWarningKind): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, shop: { select: { ownerId: true } } },
    });
    if (order === null) {
      // The sweep task that called this just selected this id inside the same pass — unreachable
      // in practice, but there is nobody left to warn if it ever happened.
      return;
    }

    const recipientUserId = kind === 'PAYMENT' ? order.buyerId : order.shop.ownerId;
    const { type, subject, body } = contentFor(kind, orderId);

    await this.notifications.notify(
      { userId: recipientUserId, type, message: body, targetType: 'ORDER', targetId: orderId },
      { subject, body },
    );
  }
}

function contentFor(kind: OrderDeadlineWarningKind, orderId: string): { type: NotificationType; subject: string; body: string } {
  switch (kind) {
    case 'SHIPPING_QUOTE':
      return {
        type: 'ORDER_DEADLINE_WARNING_SHIPPING_QUOTE',
        subject: 'ใกล้หมดเวลาใส่ค่าส่ง',
        body: `ออเดอร์ ${orderId} เหลือเวลาอีกไม่ถึง 6 ชั่วโมงให้ใส่ค่าส่ง ไม่ทันจะถูกยกเลิกอัตโนมัติ`,
      };
    case 'PAYMENT':
      return {
        type: 'ORDER_DEADLINE_WARNING_PAYMENT',
        subject: 'ใกล้หมดเวลาโอนเงิน',
        body: `ออเดอร์ ${orderId} เหลือเวลาอีกไม่ถึง 6 ชั่วโมงให้โอนเงินและอัปสลิป ไม่ทันจะถูกยกเลิกอัตโนมัติ`,
      };
    case 'PAYMENT_CONFIRMATION':
      return {
        type: 'ORDER_DEADLINE_WARNING_PAYMENT_CONFIRMATION',
        subject: 'ใกล้หมดเวลายืนยันเงินเข้า',
        body: `ออเดอร์ ${orderId} เหลือเวลาอีกไม่ถึง 24 ชั่วโมงให้ยืนยันเงินเข้า ไม่ทันจะเข้าสู่ขั้นตอนคืนเงินอัตโนมัติ`,
      };
  }
}
