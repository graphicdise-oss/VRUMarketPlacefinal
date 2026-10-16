import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isUuid } from '../common/id.js';
import { ShopScopeResolver } from '../community/shop-scope-resolver.js';
import { ChatService } from './chat.service.js';

/**
 * #68: resolves the community a chat room's admin read is scoped to — and, as a side effect of
 * how it has to find that community, is also the *entire* "does this room currently qualify for
 * break-glass" check.
 *
 * A room (K14) is keyed on (buyerId, shopOwnerUserId), not on any one shop or dispute, so unlike
 * `DisputeIdScopeResolver` (one dispute, one denormalized `shopId`) there is no single community
 * to read off the room row itself — H12's "ย้ายชุมชน = ปิดร้านเดิมแล้วเปิดใหม่" means the same
 * owner can have had shops in different communities over time, so "the owner's shop" is not one
 * answer either. The only community that is ever correct here is the one on the *specific* open
 * dispute's own shop (`Dispute.shopId`, denormalized the same way `DisputeIdScopeResolver` reads
 * it) — so this resolver walks every dispute on an order between this room's two parties, and
 * for each asks `DisputeService.isOrderUnderOpenDisputeBreakGlass` (#64's single source of truth
 * for "open", never reimplemented here) until it finds one that is currently open, and returns
 * that dispute's shop's community.
 *
 * (§83: that walk now lives in `ChatService.openDisputeCommunityId`, which this delegates to.)
 *
 * No open dispute anywhere between this pair → `null` → `CommunityScopeGuard` refuses with
 * FORBIDDEN, which is what satisfies both "แอดมินอ่านแชทไม่ได้ตอนไม่มีข้อพิพาท" and "ปิดข้อพิพาท
 * → แอดมินอ่านไม่ได้ทันที": this guard runs fresh on every request, so the instant the one open
 * dispute closes (a ruling or H7's cron), the very next read fails here, before `ChatService` is
 * even reached.
 */
@Injectable()
export class ChatRoomIdScopeResolver implements ShopScopeResolver {
  constructor(private readonly chat: ChatService) {}

  async resolveCommunityId(request: Request): Promise<string | null> {
    const roomId = request.params.roomId;
    if (typeof roomId !== 'string' || !isUuid(roomId)) {
      return null;
    }

    // §83: the walk itself moved into `ChatService.openDisputeCommunityId`, so the admin reads can
    // ask the same question for themselves — `CommunityScopeGuard` never calls this for a super
    // admin, which is how the open-dispute condition used to skip super admins entirely.
    return this.chat.openDisputeCommunityId(roomId);
  }
}
