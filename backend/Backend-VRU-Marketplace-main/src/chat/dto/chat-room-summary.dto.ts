import { ChatMessage, ChatRoom } from '@prisma/client';
import { ChatMessageDto } from './chat-message.dto.js';

/**
 * One row of `listRooms` — a room plus its most recent message, so a client can render an inbox
 * without a second round trip per row (user story 4/#12: "เห็นรายการห้องแชทของฉันพร้อมข้อความล่าสุด").
 *
 * `unreadCount` (#67, K17) is specific to the caller — the buyer and the shop owner reading the
 * same room each get their own number, computed from their own `ChatRoomRead.lastReadAt`. It
 * counts the other party's messages only: a caller is never told their own messages are
 * "unread".
 */
interface ChatRoomWithParties extends ChatRoom {
  shopOwner?: {
    shops?: Array<{ id: string; name: string }>;
  };
  buyer?: {
    email?: string;
    addresses?: Array<{ recipientName?: string }>;
  };
}

export class ChatRoomSummaryDto {
  id!: string;
  buyerId!: string;
  shopOwnerUserId!: string;
  shopName?: string;
  buyerName?: string;
  createdAt!: Date;
  lastMessage!: ChatMessageDto | null;
  unreadCount!: number;

  static from(room: ChatRoom, lastMessage: ChatMessage | null, unreadCount: number): ChatRoomSummaryDto {
    const r = room as ChatRoomWithParties;
    const dto = new ChatRoomSummaryDto();
    dto.id = r.id;
    dto.buyerId = r.buyerId;
    dto.shopOwnerUserId = r.shopOwnerUserId;
    dto.shopName = r.shopOwner?.shops?.[0]?.name ?? '';
    const emailPrefix = r.buyer?.email ? r.buyer.email.split('@')[0] : '';
    dto.buyerName = r.buyer?.addresses?.[0]?.recipientName ?? emailPrefix ?? '';
    dto.createdAt = r.createdAt;
    dto.lastMessage = lastMessage === null ? null : ChatMessageDto.from(lastMessage);
    dto.unreadCount = unreadCount;

    return dto;
  }
}
