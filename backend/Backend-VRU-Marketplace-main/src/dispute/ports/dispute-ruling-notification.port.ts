import { Injectable } from '@nestjs/common';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * K12/#64: fires once a dispute is ruled (or a ruling is overridden, I9b) — the AC's own
 * "แจ้งเตือนทั้งสองฝ่าย". Same shape as `OrderReceivedNotificationPort`/`OrderStockAdjustmentPort`
 * and the same reason: the channel is topic 12's decision, not this ticket's.
 */
export abstract class DisputeRulingNotificationPort {
  abstract notify(disputeId: string): Promise<void>;
}

/**
 * #69: notifies both the buyer and the shop owner, each with an in-app row and a
 * `DISPUTE_OUTCOME` email (I17's own "ผลข้อพิพาท" row). Reads the dispute's **current** verdict —
 * called again on an override (I9b), where it is correct for the same reason `Dispute.verdict`
 * itself is: there is only ever one live answer to "what did this dispute decide", never a
 * history of every past one.
 */
@Injectable()
export class NotifyingDisputeRulingNotificationPort extends DisputeRulingNotificationPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {
    super();
  }

  async notify(disputeId: string): Promise<void> {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: {
        verdict: true,
        rulingReason: true,
        order: { select: { id: true, buyerId: true, shop: { select: { ownerId: true } } } },
      },
    });
    if (dispute === null || dispute.verdict === null) {
      return;
    }

    const verdictText = dispute.verdict === 'BUYER_WINS' ? 'ผู้ซื้อชนะ' : 'ร้านชนะ';
    const message = `ข้อพิพาทของออเดอร์ ${dispute.order.id} ถูกตัดสินแล้ว: ${verdictText} เหตุผล: ${dispute.rulingReason ?? '-'}`;

    for (const userId of [dispute.order.buyerId, dispute.order.shop.ownerId]) {
      await this.notifications.notify(
        { userId, type: 'DISPUTE_RULED', message, targetType: 'DISPUTE', targetId: disputeId },
        { subject: 'ผลการตัดสินข้อพิพาท', body: message },
      );
    }
  }
}
