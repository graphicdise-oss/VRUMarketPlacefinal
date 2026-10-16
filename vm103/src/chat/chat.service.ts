import { Injectable } from '@nestjs/common';
import { ChatMessage, Prisma, UserRole } from '@prisma/client';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { isAnyAdmin, refuseOwnCaseAccess } from '../community/community-admin-scope.js';
import { newId } from '../common/id.js';
import { keysetAfter, keysetAfterActivity, latestActivityFirst, newestFirst } from '../common/pagination/keyset.js';
import { Page, toActivityPage, toPage } from '../common/pagination/page.js';
import { AppConfig } from '../config/app-config.module.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../files/file-storage.service.js';
import { DisputeService } from '../dispute/services/dispute.service.js';
import { NotificationService } from '../notification/notification.service.js';
import { lockLiveAccount } from '../common/live-account-lock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addHours, Clock, MS_PER_MINUTE } from '../time/clock.js';
import { CHAT_UNSEND_WINDOW_MINUTES, MAX_PENDING_CHAT_ATTACHMENTS_PER_UPLOADER, PENDING_CHAT_ATTACHMENT_TTL_HOURS } from './chat-policy.js';
import { ChatRoomSummaryDto } from './dto/chat-room-summary.dto.js';
import { ChatRoomDto } from './dto/chat-room.dto.js';
import { ChatMessageVersionDto } from './dto/chat-message-version.dto.js';
import { ChatMessageDto } from './dto/chat-message.dto.js';

/** The cursor-list name every room-list page carries (#18's per-list mismatch check). */
const ROOMS_LIST_NAME = 'chatRooms';

/** One per room, so a message cursor from one room's history is rejected against another's. */
const messagesListName = (roomId: string): string => `chatMessages:${roomId}`;

/** §89: one per message, for the same reason. */
const versionsListName = (messageId: string): string => `chatMessageVersions:${messageId}`;

const PROFANITY_PATTERN = /(เหี้ย|เย็ด|ควย|สัส|มึง|กู|ชาติหมา|ดอกทอง|ระยำ|หน้าด้าน|หน้าหมา|จัญไร|เฮงซวย|สถุล|ปัญญาอ่อน|fuck|shit|bitch|bastard|asshole|whore|cunt)/i;

function containsProfanity(text: string): boolean {
  return PROFANITY_PATTERN.test(text);
}

/**
 * #67 (L7): the key `RateLimitService` counts message rate under — per sender *within* a room
 * since §83 (the project owner's choice), not per room: counted per room, one party sending
 * thirty messages in a minute left the other unable to reply at all until the window reopened.
 */
const sendMessageRateLimitKey = (roomId: string, senderId: string): string => `chat:sendMessage|${roomId}|${senderId}`;

/**
 * `ChatRoom` + `ChatMessage` (#66/#67). Reachable from `ChatGateway` for everything conversation-
 * shaped, and from `ChatAttachmentController` for the two file operations (#67) that do not fit
 * a socket.io event — see that controller's own comment for why. F4/#12 still make this the one
 * *feature* whose real-time behaviour is WebSocket-only; the attachment endpoints are plumbing
 * around a binary upload, not a second way to hold a conversation.
 *
 * Every method takes the caller's own id and never trusts a room id alone to prove membership:
 * every query scopes by `id` **and** (`buyerId` or `shopOwnerUserId`) together, the same
 * `findFirst({ where: { id, buyerId } })` shape `docs/DECISIONS.md` already established for
 * `Order.markReceived` — a non-participant supplying a real room id gets the identical `NOT_FOUND`
 * a fabricated id would, never a `FORBIDDEN` that would confirm the room exists (#12's "ห้ามพึ่ง
 * id เดายาก เป็นกลไกความเป็นส่วนตัว").
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly files: FileStorageService,
    private readonly rateLimits: RateLimitService,
    private readonly config: AppConfig,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
    private readonly disputes: DisputeService,
  ) {}

  /**
   * Gets or creates the one room between `buyerId` and whoever currently owns `shopId` (K14).
   *
   * Resolving the owner happens once, here — the room then carries `shopOwnerUserId` on its own
   * and never looks `Shop` up again, which is what lets the room survive the shop closing and
   * reopening under H12. Restricted to an approved shop, the same visibility `ShopService.findPublic`
   * already applies to a direct link: there is no path by which a buyer legitimately knows the id
   * of a shop that was never approved.
   *
   * §105 (N29): an admin account opens no *new* room — a buyer's room with a shop is the buyer's
   * side of the marketplace, which admin accounts are kept out of like the cart, and a room would
   * let an admin talk to a shop privately, unmarked and unaudited. A room opened before the
   * appointment is still returned: that conversation is theirs, and carries on.
   */
  async openRoomWithShop(buyer: { readonly id: string; readonly role: UserRole }, shopId: string): Promise<ChatRoomDto> {
    const buyerId = buyer.id;
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, approvalStatus: 'APPROVED' },
      select: { ownerId: true },
    });
    if (shop === null) {
      throw new AppException('NOT_FOUND');
    }

    if (shop.ownerId === buyerId) {
      // A shop's own owner talking to themselves is not a conversation #66 was ever asked to
      // support, and the unique key would make it indistinguishable from a real buyer×owner pair.
      throw new AppException('VALIDATION_FAILED', { message: 'เจ้าของร้านเปิดแชทกับร้านตัวเองไม่ได้' });
    }

    const existing = await this.prisma.chatRoom.findUnique({
      where: { buyerId_shopOwnerUserId: { buyerId, shopOwnerUserId: shop.ownerId } },
    });
    if (existing !== null) {
      return ChatRoomDto.from(existing);
    }

    if (await isAnyAdmin(this.prisma, buyerId, buyer.role)) {
      throw new AppException('FORBIDDEN', { message: 'บัญชีแอดมินเปิดห้องแชทใหม่กับร้านไม่ได้ กรุณาใช้บัญชีผู้ใช้ทั่วไปแยกต่างหาก' });
    }

    try {
      const now = this.clock.now();
      const room = await this.prisma.chatRoom.create({
        data: { id: newId(), buyerId, shopOwnerUserId: shop.ownerId, createdAt: now, lastActivityAt: now },
      });

      return ChatRoomDto.from(room);
    } catch (error) {
      // §83: two tabs opening the same room at the same instant both saw "no room yet" above and
      // both tried to create it; the unique key let one through and used to answer the other
      // with INTERNAL_ERROR. The room the winner just created is exactly what the loser asked for.
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const created = await this.prisma.chatRoom.findUniqueOrThrow({
        where: { buyerId_shopOwnerUserId: { buyerId, shopOwnerUserId: shop.ownerId } },
      });

      return ChatRoomDto.from(created);
    }
  }

  /** `joinRoom`: the caller already has a room id and must be one of its two parties. */
  async getRoomForParty(userId: string, roomId: string): Promise<ChatRoomDto> {
    return ChatRoomDto.from(await this.requireParty(userId, roomId));
  }

  /**
   * Persists a message and returns it. The socket broadcast is the gateway's job — this only
   * ever writes to the database, which is what makes a message sent while the other party is
   * offline durable rather than lost (#12's own testing decision #4).
   *
   * L7's 30-a-minute ceiling is counted here, not in a guard: `sendMessage` is the one chat event
   * that does real, repeatable work (a database write plus a broadcast), and it is the one that
   * `RateLimitService.consume` — the same in-memory counter #28 built for HTTP, reused directly
   * rather than through `RateLimitPolicy`/`RateLimitGuard`, which assume an Express `Request` — is
   * keyed per sender within a room (see `sendMessageRateLimitKey` for why no longer per room).
   * ⚠️ Same single-instance caveat as every other in-memory counter in this system
   * (K1's framing in CLAUDE.md): two API processes would each keep their own count, silently
   * doubling this ceiling.
   */
  async sendMessage(senderId: string, roomId: string, content: string | undefined, orderId?: string, fileId?: string): Promise<ChatMessageDto> {
    const room = await this.requireParty(senderId, roomId);

    const recipientUserId = senderId === room.buyerId ? room.shopOwnerUserId : room.buyerId;

    // §130: check if either party has blocked the other
    const isBlocked = await this.prisma.chatBlock.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: recipientUserId },
          { blockerId: recipientUserId, blockedId: senderId },
        ],
      },
    });
    if (isBlocked !== null) {
      throw new AppException('VALIDATION_FAILED', {
        fieldErrors: { content: 'ไม่สามารถส่งข้อความได้เนื่องจากมีการบล็อกผู้ใช้งาน' },
      });
    }

    const trimmedContent = content?.trim() ?? '';
    if (trimmedContent.length === 0 && fileId === undefined) {
      throw new AppException('VALIDATION_FAILED', {
        fieldErrors: { content: 'พิมพ์ข้อความ หรือแนบรูปอย่างน้อยหนึ่งอย่าง' },
      });
    }

    // §130: check profanity
    if (containsProfanity(trimmedContent)) {
      throw new AppException('VALIDATION_FAILED', {
        fieldErrors: { content: 'ข้อความมีคำไม่สุภาพหรือไม่เหมาะสม กรุณาใช้คำที่สุภาพ' },
      });
    }

    // §130: anti-spam check (rapid duplicate text within 3s)
    if (trimmedContent.length > 0 && fileId === undefined) {
      const recentSame = await this.prisma.chatMessage.findFirst({
        where: {
          roomId: room.id,
          senderId,
          content: trimmedContent,
          createdAt: {
            gte: new Date(this.clock.nowMs() - 3000),
          },
        },
      });
      if (recentSame !== null) {
        throw new AppException('VALIDATION_FAILED', {
          fieldErrors: { content: 'ส่งข้อความซ้ำเร็วเกินไป กรุณารอสักครู่' },
        });
      }
    }

    if (orderId !== undefined) {
      await this.requireOrderBelongsToRoom(room, orderId);
    }

    const outcome = await this.rateLimits.consume(sendMessageRateLimitKey(room.id, senderId), this.config.rateLimitChatMessagePerMinute, MS_PER_MINUTE);
    if (!outcome.allowed) {
      throw new AppException('RATE_LIMITED');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      // §91: a message is the sender's own words, overwritten by their erasure (G3/H8) — sent under
      // the account's `FOR SHARE` lock so one sent while the erasure commits cannot outlive it.
      await lockLiveAccount(tx, senderId);
      if (fileId !== undefined) {
        // §83: the claim *is* the check — only a row this sender's own upload created, in this very
        // room, and not yet sent can be deleted here (see `ChatPendingAttachment`). Before, any
        // uploaded file's id was accepted: another room's picture, a payment slip, even a PDF.
        const claimed = await tx.chatPendingAttachment.deleteMany({ where: { fileId, roomId: room.id, uploaderId: senderId } });
        if (claimed.count === 0) {
          throw new AppException('VALIDATION_FAILED', {
            fieldErrors: { fileId: 'รูปนี้ไม่ได้อัปโหลดไว้สำหรับห้องนี้ ถูกส่งไปแล้ว หรือหมดอายุแล้ว กรุณาอัปโหลดใหม่' },
          });
        }
      }

      const created = await tx.chatMessage.create({
        data: {
          id: newId(),
          roomId: room.id,
          senderId,
          orderId: orderId ?? null,
          fileId: fileId ?? null,
          content: trimmedContent,
          createdAt: this.clock.now(),
        },
      });
      // §108: the room rises to the top of both parties' inboxes.
      await tx.chatRoom.update({ where: { id: room.id }, data: { lastActivityAt: created.createdAt } });

      return created;
    });

    // #69 (I17): in-app only, to whichever party did not send it — a room's real-time socket
    // broadcast (ChatGateway) only reaches someone actually connected right now; this is what a
    // party who is offline sees when they come back, even before they open the room.
    // §84 (the project owner's choice): one unread notice per room, not one per message — while
    // the recipient still has an unread CHAT_MESSAGE for this room, another message adds nothing to
    // it (the room's own `unreadCount` in `listRooms` already counts messages). Reading
    // notifications lets the next message raise a fresh one.
    if (!(await this.notifications.hasUnread(recipientUserId, 'CHAT_MESSAGE', room.id))) {
      await this.notifications.notify({
        userId: recipientUserId,
        type: 'CHAT_MESSAGE',
        message: 'มีข้อความใหม่ในห้องแชท',
        targetType: 'CHAT_ROOM',
        targetId: room.id,
      });
    }

    return ChatMessageDto.from(message);
  }

  /**
   * §89: the sender changes their own message's text, with no time limit (the project owner's
   * choice, Messenger's model). Nothing is lost: the first edit records the original as a
   * `ChatMessageVersion` alongside the new text, every later edit adds one more, and both parties
   * can read them all (`listMessageVersions`) — so a late edit cannot quietly rewrite what was
   * agreed, which is what keeps the chat usable as dispute evidence (H8).
   *
   * Text only: the picture stays (`EditMessageDto` has no `fileId`). Saving the same text again is
   * not an edit — no version, no "edited" mark. Edits share `sendMessage`'s per-sender rate limit
   * (L7): a version history anyone can read must not be floodable.
   *
   * Locks the message row, so two edits at once cannot both record the original, and an unsend at
   * the same moment is decided one way or the other rather than half-applied.
   */
  async editMessage(senderId: string, roomId: string, messageId: string, content: string): Promise<EditOutcome> {
    const room = await this.requireParty(senderId, roomId);
    const message = await this.requireOwnMessage(room.id, senderId, messageId);
    requireNotUnsent(message);
    const newContent = content.trim();
    if (newContent.length === 0 && message.fileId === null) {
      throw new AppException('VALIDATION_FAILED', { fieldErrors: { content: 'ข้อความที่ไม่มีรูปแนบ ต้องมีตัวหนังสืออย่างน้อยหนึ่งตัว' } });
    }
    if (containsProfanity(newContent)) {
      throw new AppException('VALIDATION_FAILED', { fieldErrors: { content: 'ข้อความมีคำไม่สุภาพหรือไม่เหมาะสม กรุณาใช้คำที่สุภาพ' } });
    }
    if (newContent === message.content) {
      return { message: ChatMessageDto.from(message), changed: false };
    }

    const outcome = await this.rateLimits.consume(sendMessageRateLimitKey(room.id, senderId), this.config.rateLimitChatMessagePerMinute, MS_PER_MINUTE);
    if (!outcome.allowed) {
      throw new AppException('RATE_LIMITED');
    }

    const edited = await this.prisma.$transaction(async (tx) => {
      await lockLiveAccount(tx, senderId);
      const current = await lockMessage(tx, message.id);
      requireNotUnsent(current);
      if (newContent === current.content) {
        return { row: current, changed: false };
      }

      const now = this.clock.now();
      const hasHistory = (await tx.chatMessageVersion.count({ where: { messageId: current.id } })) > 0;
      if (!hasHistory) {
        await tx.chatMessageVersion.create({ data: { id: newId(), messageId: current.id, content: current.content, writtenAt: current.createdAt } });
      }
      await tx.chatMessageVersion.create({ data: { id: newId(), messageId: current.id, content: newContent, writtenAt: now } });

      return { row: await tx.chatMessage.update({ where: { id: current.id }, data: { content: newContent, editedAt: now } }), changed: true };
    });

    return { message: ChatMessageDto.from(edited.row), changed: edited.changed };
  }

  /**
   * §89: the sender takes a message back within `CHAT_UNSEND_WINDOW_MINUTES` of sending it. Both
   * parties then see only that it was unsent — its text, picture and version history are hidden
   * from them — but the row keeps all of it, for an admin under an open dispute (H8: unsending
   * must not destroy evidence). Final: an unsent message can be neither edited nor unsent again.
   */
  async unsendMessage(senderId: string, roomId: string, messageId: string): Promise<ChatMessageDto> {
    const room = await this.requireParty(senderId, roomId);
    const message = await this.requireOwnMessage(room.id, senderId, messageId);
    requireNotUnsent(message);

    const unsent = await this.prisma.$transaction(async (tx) => {
      const current = await lockMessage(tx, message.id);
      requireNotUnsent(current);

      const now = this.clock.now();
      if (now.getTime() > current.createdAt.getTime() + CHAT_UNSEND_WINDOW_MINUTES * MS_PER_MINUTE) {
        throw new AppException('CONFLICT', {
          message: `ยกเลิกการส่งได้ภายใน ${String(CHAT_UNSEND_WINDOW_MINUTES)} นาทีหลังส่งเท่านั้น ข้อความนี้ยังแก้ไขได้ และประวัติการแก้ไขจะแสดงให้อีกฝ่ายเห็น`,
        });
      }

      return tx.chatMessage.update({ where: { id: current.id }, data: { unsentAt: now } });
    });

    return ChatMessageDto.from(unsent);
  }

  /**
   * §89: every text a message has shown, newest first — either party may read it (the owner's
   * choice: Messenger shows edit history to both sides). An unsent message has no history to show
   * the parties: NOT_FOUND, as if the message's contents were no longer there, which for them
   * they are not.
   */
  async listMessageVersions(userId: string, roomId: string, messageId: string, cursor: string | undefined, limit: number): Promise<Page<ChatMessageVersionDto>> {
    await this.requireParty(userId, roomId);
    const message = await this.prisma.chatMessage.findFirst({ where: { id: messageId, roomId, unsentAt: null } });
    if (message === null) {
      throw new AppException('NOT_FOUND');
    }

    return this.pageOfVersions(message, cursor, limit);
  }

  /** #68/§89: the same history under break-glass — an unsent message's included — audited like every other admin read. */
  async listMessageVersionsAsAdmin(actorUserId: string, roomId: string, messageId: string, cursor: string | undefined, limit: number): Promise<Page<ChatMessageVersionDto>> {
    const communityId = await this.requireOpenDisputeCommunityId(actorUserId, roomId);
    const message = await this.prisma.chatMessage.findFirst({ where: { id: messageId, roomId } });
    if (message === null) {
      throw new AppException('NOT_FOUND');
    }

    const page = await this.pageOfVersions(message, cursor, limit);
    await this.audit.record({ actorUserId, action: 'DISPUTE_CHAT_VIEWED', targetType: 'CHAT_ROOM', targetId: roomId, communityId });

    return page;
  }

  /**
   * A room's history, **newest first**, the same as every other list in this system (#18) — and
   * the way every mainstream chat app loads a conversation: the first page is what was said last,
   * and each `nextCursor` reaches further back. The cursor is scoped per room
   * (`messagesListName`), so a page taken from one room's history is rejected rather than silently
   * returning nonsense against another's.
   *
   * §83 (the project owner's choice): this used to read oldest first, so opening a long room
   * showed its very first messages and the latest were only reachable by paging through all of
   * it. A client catching up after a reconnect reads from the top until it reaches a message it
   * already has — no second "after this id" parameter needed.
   *
   * Also the read signal for #67's unread count (K17) — see `markReadUpTo`.
   */
  async listMessages(userId: string, roomId: string, cursor: string | undefined, limit: number): Promise<Page<ChatMessageDto>> {
    const room = await this.requireParty(userId, roomId);

    const page = await this.pageOfMessages(roomId, cursor, limit, userId);
    await this.markReadUpTo(userId, roomId, page.items[0]);

    const otherPartyId = userId === room.buyerId ? room.shopOwnerUserId : room.buyerId;
    const otherRead = await this.prisma.chatRoomRead.findUnique({
      where: { roomId_userId: { roomId, userId: otherPartyId } },
    });
    const otherLastReadAt = otherRead?.lastReadAt;

    return {
      ...page,
      items: page.items.map((row) => {
        const isRead = row.senderId === userId ? (otherLastReadAt !== undefined && row.createdAt <= otherLastReadAt) : true;
        return ChatMessageDto.from(row, isRead);
      }),
    };
  }

  /**
   * The caller's own rooms, **newest activity first** (§108, the owner's choice — the way every
   * messaging app shows an inbox), each with its latest message and how many of the other party's
   * messages are unread. Before §108 this was newest-*created* first, and a shop with many buyers
   * lost a reply from an old customer below every room opened since.
   */
  async listRoomsForUser(userId: string, cursor: string | undefined, limit: number): Promise<Page<ChatRoomSummaryDto>> {
    const rows = await this.prisma.chatRoom.findMany({
      where: { AND: [{ OR: [{ buyerId: userId }, { shopOwnerUserId: userId }] }, keysetAfterActivity(cursor, ROOMS_LIST_NAME)] },
      include: {
        shopOwner: { include: { shops: { select: { id: true, name: true } } } },
        buyer: {
          select: {
            id: true,
            email: true,
            addresses: { select: { recipientName: true }, take: 1 },
          },
        },
      },
      orderBy: latestActivityFirst(),
      take: limit + 1,
    });

    const page = toActivityPage(rows, limit, ROOMS_LIST_NAME);
    const roomIds = page.items.map((room) => room.id);
    const [lastMessageByRoomId, unreadCountByRoomId] = await Promise.all([this.lastMessagesFor(roomIds), this.unreadCountsFor(userId, roomIds)]);

    return {
      ...page,
      items: page.items.map((room) => ChatRoomSummaryDto.from(room, lastMessageByRoomId.get(room.id) ?? null, unreadCountByRoomId.get(room.id) ?? 0)),
    };
  }

  /**
   * Stores an attachment for a room the caller is a party of, and returns only its id — never
   * attached to any message until a `sendMessage` call names it (see that method). Reuses
   * `FileStorageService.storeImage`, never `storeDocument`: K17/E1 both insist chat never accepts
   * a PDF, because the one thing in this system that *does* accept one is a payment slip, and a
   * chat message that could smuggle one in would be a second, unlogged way to hand a shop "proof"
   * of a transfer that no order ties it to. `storeImage` already sniffs the real file format
   * (never a client-supplied extension or Content-Type) and re-encodes to strip EXIF (K1).
   */
  /**
   * A room the caller is a party to, with room for another pending photo. Also asked by the upload
   * route before the file is read (§100, `@AcceptsUpload`).
   */
  async requireAttachmentUploadable(userId: string, roomId: string): Promise<void> {
    await this.requireParty(userId, roomId);
    // §83: refused before any re-encoding or disk write when the cap is already reached — the
    // common way to hit it, and the one that must cost the server nothing.
    await this.requirePendingUploadRoom(this.prisma, roomId, userId);
  }

  async uploadAttachment(userId: string, roomId: string, upload: UploadedTempFile): Promise<{ fileId: string }> {
    await this.requireAttachmentUploadable(userId, roomId);

    const stored = await this.files.storeImage(upload);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Checked again under a lock on the room row: every upload into this room queues here, so
        // concurrent uploads cannot all pass the count above together and overshoot the cap.
        await lockLiveAccount(tx, userId);
        await tx.$queryRaw`SELECT id FROM chat_room WHERE id = ${roomId}::uuid FOR UPDATE`;
        await this.requirePendingUploadRoom(tx, roomId, userId);
        await tx.chatPendingAttachment.create({
          data: { fileId: stored.id, roomId, uploaderId: userId, createdAt: this.clock.now() },
        });
      });
    } catch (error) {
      await this.files.discardUnattached(stored.id);
      throw error;
    }

    return { fileId: stored.id };
  }

  /**
   * §83: deletes every chat upload that waited longer than `PENDING_CHAT_ATTACHMENT_TTL_HOURS`
   * without being sent — the row and the file's bytes both. Returns how many went.
   *
   * One at a time, each claimed by deleting its own row first under the same age condition: a
   * `sendMessage` claiming the same file at the same moment deletes the same row, so exactly one
   * of the two wins — a file is either attached to a message or discarded, never both.
   */
  async discardExpiredPendingAttachments(now: Date): Promise<number> {
    const expired = { createdAt: { lte: addHours(now, -PENDING_CHAT_ATTACHMENT_TTL_HOURS) } } satisfies Prisma.ChatPendingAttachmentWhereInput;
    const candidates = await this.prisma.chatPendingAttachment.findMany({ where: expired, select: { fileId: true } });

    let discarded = 0;
    for (const { fileId } of candidates) {
      const claimed = await this.prisma.chatPendingAttachment.deleteMany({ where: { fileId, ...expired } });
      if (claimed.count === 0) {
        continue;
      }
      await this.files.discardUnattached(fileId);
      discarded += 1;
    }

    return discarded;
  }

  /**
   * Bytes for an attachment, readable only by a party of the room **and** only once the file is
   * genuinely part of that room's history — an id from an upload nobody ever sent a message with
   * is not readable through this route by anyone, uploader included, which is simpler than
   * tracking "abandoned" uploads separately and costs nothing a real client needs (K1: no path
   * from user input to a file path; this is the "who may see it" half of that rule).
   */
  async readAttachment(userId: string, roomId: string, fileId: string): Promise<ReadImage> {
    await this.requireParty(userId, roomId);

    // §89: a picture in an unsent message is gone for the parties, the way its text is.
    const message = await this.prisma.chatMessage.findFirst({ where: { roomId, fileId, unsentAt: null }, select: { id: true } });
    if (message === null) {
      throw new AppException('NOT_FOUND');
    }

    const image = await this.files.readImage(fileId);
    if (image === null) {
      throw new AppException('NOT_FOUND');
    }

    return image;
  }

  /**
   * #68's break-glass read: a room's *entire* history, not just messages sent while a dispute was
   * open — the AC is explicit that this is the whole room. Never calls `requireParty` (the admin
   * reading is not one of the room's two parties) and never calls `markReadUpTo` (an admin's read
   * must not move the buyer's or shop owner's own unread count). `ChatRoomIdScopeResolver` decides
   * which community's admins may call this; whether a dispute is open *right now* is re-checked
   * here as well (`requireOpenDisputeCommunityId`), because that guard never asks a super admin (§83).
   *
   * Shares the same room-scoped cursor name as the party-facing `listMessages`: the two never
   * exchange cursors across each other's routes, but there is only one meaningful ordering of one
   * room's messages, so there is no reason to key it twice.
   */
  async listMessagesAsAdmin(actorUserId: string, roomId: string, cursor: string | undefined, limit: number): Promise<Page<ChatMessageDto>> {
    const communityId = await this.requireOpenDisputeCommunityId(actorUserId, roomId);
    const page = await this.pageOfMessages(roomId, cursor, limit);

    // #68: every read, not just the first — CLAUDE.md invariant 8 and the ticket's own AC both
    // say so in as many words. Logged after the query succeeds, and only who/what/when — never
    // the message content itself (the same restraint DisputeService's own break-glass entries use).
    // §83: with the open dispute's community (§75), which this entry used to leave null.
    await this.audit.record({ actorUserId, action: 'DISPUTE_CHAT_VIEWED', targetType: 'CHAT_ROOM', targetId: roomId, communityId });

    // §89: the admin's view keeps an unsent message's original — the one reader it is kept for.
    return { ...page, items: page.items.map((row) => ChatMessageDto.forAdmin(row)) };
  }

  /**
   * #68's break-glass read of one attachment — same "access already proven upstream" shape as
   * `listMessagesAsAdmin` above, and the same "must genuinely belong to this room" check
   * `readAttachment` uses, so an id that was never attached to a message in this room 404s here
   * exactly as it would for the room's own parties.
   */
  async readAttachmentAsAdmin(actorUserId: string, roomId: string, fileId: string): Promise<ReadImage> {
    const communityId = await this.requireOpenDisputeCommunityId(actorUserId, roomId);
    const message = await this.prisma.chatMessage.findFirst({ where: { roomId, fileId }, select: { id: true } });
    if (message === null) {
      throw new AppException('NOT_FOUND');
    }

    const image = await this.files.readImage(fileId);
    if (image === null) {
      throw new AppException('NOT_FOUND');
    }

    await this.audit.record({ actorUserId, action: 'DISPUTE_CHAT_VIEWED', targetType: 'CHAT_ROOM', targetId: roomId, communityId });

    return image;
  }

  /**
   * One query per room rather than a window function, on purpose: a caller's own room list is at
   * most 50 rows (#18's page-size ceiling), and this system has no Redis and no read replica to
   * offload a fancier query onto — see K1's "single instance" framing in CLAUDE.md. A window
   * function would be the right call at a scale this deployment does not have.
   */
  private async lastMessagesFor(roomIds: readonly string[]): Promise<Map<string, ChatMessage | null>> {
    const lastMessageByRoomId = new Map<string, ChatMessage | null>();

    await Promise.all(
      roomIds.map(async (roomId) => {
        const last = await this.prisma.chatMessage.findFirst({ where: { roomId }, orderBy: { id: 'desc' } });
        lastMessageByRoomId.set(roomId, last);
      }),
    );

    return lastMessageByRoomId;
  }

  /**
   * How many of the *other* party's messages are newer than this caller's own `lastReadAt` in
   * each room — never a message the caller sent themselves (K17's "count of new messages", not
   * "count of activity"). No row in `chat_room_read` means "never read", counted as every one of
   * the other party's messages rather than zero — the same generous-in-one-direction choice
   * `markRead` documents for the opposite case.
   */
  private async unreadCountsFor(userId: string, roomIds: readonly string[]): Promise<Map<string, number>> {
    const reads = await this.prisma.chatRoomRead.findMany({ where: { userId, roomId: { in: [...roomIds] } } });
    const lastReadAtByRoomId = new Map(reads.map((read) => [read.roomId, read.lastReadAt]));
    const unreadCountByRoomId = new Map<string, number>();

    await Promise.all(
      roomIds.map(async (roomId) => {
        const lastReadAt = lastReadAtByRoomId.get(roomId);
        const count = await this.prisma.chatMessage.count({
          where: {
            roomId,
            senderId: { not: userId },
            ...(lastReadAt !== undefined ? { createdAt: { gt: lastReadAt } } : {}),
          },
        });
        unreadCountByRoomId.set(roomId, count);
      }),
    );

    return unreadCountByRoomId;
  }

  /**
   * #67's read signal: fetching history is, in the ordinary case, genuinely reading it, and there
   * is no dedicated "mark read" event to grow a second signal that could drift from this one.
   *
   * §83: moves `lastReadAt` to the newest message *this page actually returned*, and never
   * backwards — the way Slack and Discord keep a per-conversation read marker. Before, it was set
   * to "now" on every call, so reading an old page (or, with the old oldest-first order, merely
   * opening a long room) marked every message read, including ones the caller had never been
   * shown (verified: unread 20 → 0 after a page holding only the oldest five). An empty page
   * moves nothing.
   */
  async markReadUpTo(userId: string, roomId: string, newestShown: ChatMessage | undefined): Promise<Date | undefined> {
    if (newestShown === undefined) {
      return undefined;
    }

    const readUpTo = newestShown.createdAt;
    await this.prisma.chatRoomRead.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { id: newId(), roomId, userId, lastReadAt: readUpTo },
      update: {},
    });
    await this.prisma.chatRoomRead.updateMany({
      where: { roomId, userId, lastReadAt: { lt: readUpTo } },
      data: { lastReadAt: readUpTo },
    });
    return readUpTo;
  }

  /** One page of a room's messages, newest first — filtered by userId's hidden and clearedAt markers. */
  private async pageOfMessages(roomId: string, cursor: string | undefined, limit: number, userId?: string): Promise<Page<ChatMessage>> {
    let clearedAt: Date | undefined;
    if (userId !== undefined) {
      const read = await this.prisma.chatRoomRead.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });
      clearedAt = read?.clearedAt ?? undefined;
    }

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        roomId,
        ...(userId !== undefined ? { hiddenBy: { none: { userId } } } : {}),
        ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
        ...keysetAfter(cursor, messagesListName(roomId)),
      },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    return toPage(rows, limit, messagesListName(roomId));
  }

  /**
   * #68/§83: the community of an order between this room's two parties that has a dispute open
   * *right now*, or `null`. The one place that question is answered — `ChatRoomIdScopeResolver`
   * asks it for the community-admin guard, and the admin reads below ask it again for themselves.
   *
   * Walks every dispute between the pair rather than one shop's, because H12 lets the same owner
   * have had shops in different communities (see the resolver's comment), and defers "open" to
   * #64's own `isOrderUnderOpenDisputeBreakGlass` rather than re-deciding it here.
   */
  async openDisputeCommunityId(roomId: string): Promise<string | null> {
    return (await this.openDisputeOf(roomId))?.communityId ?? null;
  }

  /** `openDisputeCommunityId`, plus the room's two parties it already read (§102's party check). */
  private async openDisputeOf(roomId: string): Promise<{ communityId: string; room: { buyerId: string; shopOwnerUserId: string } } | null> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { buyerId: true, shopOwnerUserId: true },
    });
    if (room === null) {
      return null;
    }

    const candidateDisputes = await this.prisma.dispute.findMany({
      where: { order: { buyerId: room.buyerId, shop: { ownerId: room.shopOwnerUserId } } },
      select: { orderId: true, shop: { select: { communityId: true } } },
    });

    for (const dispute of candidateDisputes) {
      if (await this.disputes.isOrderUnderOpenDisputeBreakGlass(dispute.orderId)) {
        return { communityId: dispute.shop.communityId, room };
      }
    }

    return null;
  }

  /**
   * §83: the admin reads' own open-dispute check. `CommunityScopeGuard` lets a super admin through
   * before it ever calls a resolver — right for "which community", but it meant the open-dispute
   * condition, which lived only in the resolver, never applied to a super admin at all (verified:
   * after a ruling closed the only dispute, a community admin got 403 and a super admin 200).
   * Invariant 8 names no exception: *every* admin reads a chat only while its dispute is open.
   * FORBIDDEN, the same answer the guard gives a community admin in the same state.
   */
  private async requireOpenDisputeCommunityId(actorUserId: string, roomId: string): Promise<string> {
    const open = await this.openDisputeOf(roomId);
    if (open === null) {
      throw new AppException('FORBIDDEN');
    }
    // §102: never one of the room's own two parties — the admin view keeps what the other side
    // unsent (§89), which a party is exactly who must not read. They have their own view of the room.
    refuseOwnCaseAccess(actorUserId, { buyerId: open.room.buyerId, shopOwnerId: open.room.shopOwnerUserId });

    return open.communityId;
  }

  /** §83: refuses an upload once this person already has the maximum unsent in this room. */
  private async requirePendingUploadRoom(client: Prisma.TransactionClient | PrismaService, roomId: string, uploaderId: string): Promise<void> {
    const pending = await client.chatPendingAttachment.count({ where: { roomId, uploaderId } });
    if (pending >= MAX_PENDING_CHAT_ATTACHMENTS_PER_UPLOADER) {
      throw new AppException('CONFLICT', {
        message: `มีรูปที่อัปโหลดไว้แต่ยังไม่ได้ส่งครบ ${String(MAX_PENDING_CHAT_ATTACHMENTS_PER_UPLOADER)} รูปแล้ว ส่งรูปที่ค้างอยู่ก่อน หรือรอให้ระบบล้างรูปที่ไม่ได้ส่ง (24 ชั่วโมง) แล้วค่อยอัปใหม่`,
      });
    }
  }

  /**
   * The shared membership check every method above funnels through. `findFirst` scoped by id
   * *and* party in the same query — never "find by id, then check the field in application
   * code" — so there is exactly one place this system decides who may touch a room.
   */
  private async requireParty(userId: string, roomId: string) {
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, OR: [{ buyerId: userId }, { shopOwnerUserId: userId }] },
    });
    if (room === null) {
      throw new AppException('NOT_FOUND');
    }

    return room;
  }

  /**
   * §89: a message in this room that this caller sent. Anyone else's — the other party's included —
   * is NOT_FOUND, the same answer `requireParty` gives a stranger, so editing and unsending never
   * reveal whether an id they may not touch exists.
   */
  private async requireOwnMessage(roomId: string, senderId: string, messageId: string): Promise<ChatMessage> {
    const message = await this.prisma.chatMessage.findFirst({ where: { id: messageId, roomId, senderId } });
    if (message === null) {
      throw new AppException('NOT_FOUND');
    }

    return message;
  }

  /**
   * §89: a message's versions, newest first. A message never edited has no `ChatMessageVersion`
   * rows (they are written from the first edit on), so its one version — the text it was sent with
   * — is answered from the message itself, as a single, final page.
   */
  private async pageOfVersions(message: ChatMessage, cursor: string | undefined, limit: number): Promise<Page<ChatMessageVersionDto>> {
    const listName = versionsListName(message.id);
    const rows = await this.prisma.chatMessageVersion.findMany({
      where: { messageId: message.id, ...keysetAfter(cursor, listName) },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    if (message.editedAt === null && rows.length === 0) {
      const items = cursor === undefined ? [ChatMessageVersionDto.of(message.id, message.content, message.createdAt)] : [];
      return { items, nextCursor: null, hasMore: false };
    }

    const page = toPage(rows, limit, listName);
    return { ...page, items: page.items.map((row) => ChatMessageVersionDto.of(row.id, row.content, row.writtenAt)) };
  }

  /**
   * A message may reference an order (F4's optional field), but only one that genuinely
   * connects these exact two people — never an arbitrary id the caller happens to know.
   */
  private async requireOrderBelongsToRoom(room: { buyerId: string; shopOwnerUserId: string }, orderId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: room.buyerId, shop: { ownerId: room.shopOwnerUserId } },
      select: { id: true },
    });

    if (order === null) {
      throw new AppException('VALIDATION_FAILED', {
        fieldErrors: { orderId: 'ออเดอร์นี้ไม่ได้เป็นของผู้ซื้อและร้านในห้องแชทนี้' },
      });
    }
  }

  /** §130: Block counterpart in chat */
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่สามารถบล็อกตัวเองได้' });
    }
    await this.prisma.chatBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { id: newId(), blockerId, blockedId, createdAt: this.clock.now() },
      update: {},
    });
  }

  /** §130: Unblock counterpart */
  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.prisma.chatBlock.deleteMany({
      where: { blockerId, blockedId },
    });
  }

  /** §130: Check block status */
  async isUserBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const count = await this.prisma.chatBlock.count({
      where: { blockerId, blockedId },
    });
    return count > 0;
  }

  /** §130: Report abusive chat room or message */
  async reportRoom(reporterId: string, roomId: string, reason: string, details?: string, messageId?: string): Promise<{ id: string }> {
    const room = await this.requireParty(reporterId, roomId);
    const reportedId = reporterId === room.buyerId ? room.shopOwnerUserId : room.buyerId;

    const report = await this.prisma.chatReport.create({
      data: {
        id: newId(),
        reporterId,
        reportedId,
        roomId: room.id,
        messageId: messageId ?? null,
        reason,
        details: details ?? null,
        status: 'PENDING',
        createdAt: this.clock.now(),
      },
    });

    return { id: report.id };
  }

  /** §130: Hide message from own view (delete on own side) */
  async hideMessage(userId: string, roomId: string, messageId: string): Promise<void> {
    await this.requireParty(userId, roomId);
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, roomId },
    });
    if (!message) {
      throw new AppException('NOT_FOUND');
    }

    await this.prisma.chatMessageHidden.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { id: newId(), messageId, userId, hiddenAt: this.clock.now() },
      update: {},
    });
  }

  /** §130: Clear chat room history on own side */
  async clearRoom(userId: string, roomId: string): Promise<void> {
    await this.requireParty(userId, roomId);
    const now = this.clock.now();
    await this.prisma.chatRoomRead.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { id: newId(), roomId, userId, lastReadAt: now, clearedAt: now },
      update: { clearedAt: now },
    });
  }

  /** §130: Search messages in room (excluding hidden/cleared messages) */
  async searchMessages(userId: string, roomId: string, query: string, limit = 30): Promise<ChatMessageDto[]> {
    const room = await this.requireParty(userId, roomId);
    const read = await this.prisma.chatRoomRead.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    const clearedAt = read?.clearedAt ?? undefined;

    const otherPartyId = userId === room.buyerId ? room.shopOwnerUserId : room.buyerId;
    const otherRead = await this.prisma.chatRoomRead.findUnique({
      where: { roomId_userId: { roomId, userId: otherPartyId } },
    });
    const otherLastReadAt = otherRead?.lastReadAt;

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        roomId,
        unsentAt: null,
        content: { contains: query, mode: 'insensitive' },
        hiddenBy: { none: { userId } },
        ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((r) => {
      const isRead = r.senderId === userId ? (otherLastReadAt !== undefined && r.createdAt <= otherLastReadAt) : true;
      return ChatMessageDto.from(r, isRead);
    });
  }
}

/**
 * §89: the message row, locked for the rest of the transaction — edits and unsends of one message
 * queue here, so each sees the others' result instead of all acting on the same stale read.
 */
async function lockMessage(tx: Prisma.TransactionClient, messageId: string): Promise<ChatMessage> {
  await tx.$queryRaw`SELECT id FROM chat_message WHERE id = ${messageId}::uuid FOR UPDATE`;
  return tx.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
}

/** §89: unsending is final — neither the text nor the unsend itself can be changed afterwards. */
function requireNotUnsent(message: ChatMessage): void {
  if (message.unsentAt !== null) {
    throw new AppException('CONFLICT', { message: 'ข้อความนี้ถูกยกเลิกการส่งแล้ว แก้ไขหรือยกเลิกซ้ำไม่ได้' });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * §89 · §91 (review): what an edit did. `changed: false` is the same text saved again — nothing
 * was stored, so the gateway has nothing to push to the room.
 */
export interface EditOutcome {
  readonly message: ChatMessageDto;
  readonly changed: boolean;
}
