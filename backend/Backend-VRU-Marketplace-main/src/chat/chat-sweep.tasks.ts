import { Injectable, OnModuleInit } from '@nestjs/common';
import { SweepTask } from '../time/sweep.js';
import { SweepService } from '../time/sweep.service.js';
import { ChatService } from './chat.service.js';
import { ShopAdminChatService } from './shop-admin-chat.service.js';

/**
 * Code review of topic 11 (§83): deletes chat pictures that were uploaded and never sent, after
 * `PENDING_CHAT_ATTACHMENT_TTL_HOURS` — the other half of the per-person cap, so a room's unsent
 * uploads cannot sit on the server's disk forever. Before, every upload stayed, sent or not, and
 * nothing bounded how many there could be (K1: files live on this one server's volume).
 *
 * Plugged into the one sweep point (seam 2), like every other clock in this system.
 */
@Injectable()
export class ChatPendingAttachmentSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'chat.discardUnsentAttachments';

  constructor(
    private readonly chat: ChatService,
    private readonly shopAdminChat: ShopAdminChatService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  /** §106: the admin↔shop chat's unsent pictures too — one clock, both chats. */
  async runSweep(now: Date): Promise<number> {
    return (await this.chat.discardExpiredPendingAttachments(now)) + (await this.shopAdminChat.discardExpiredPendingAttachments(now));
  }
}
