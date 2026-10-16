import { Injectable } from '@nestjs/common';
import { Prisma, ShopAdminChatMessage, ShopAdminChatRoom, ShopApprovalStatus, UserRole } from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service.js';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { lockLiveAccount } from '../common/live-account-lock.js';
import { keysetAfter, keysetAfterActivity, latestActivityFirst, newestFirst } from '../common/pagination/keyset.js';
import { Page, toActivityPage, toPage } from '../common/pagination/page.js';
import { communityAdminsToNotify, isAdminOfCommunity } from '../community/community-admin-scope.js';
import { AppConfig } from '../config/app-config.module.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../files/file-storage.service.js';
import { NotificationService } from '../notification/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addHours, Clock, MS_PER_MINUTE } from '../time/clock.js';
import { CHAT_UNSEND_WINDOW_MINUTES, MAX_PENDING_CHAT_ATTACHMENTS_PER_UPLOADER, PENDING_CHAT_ATTACHMENT_TTL_HOURS } from './chat-policy.js';
import { ChatMessageVersionDto } from './dto/chat-message-version.dto.js';
import { ShopAdminChatMessageDto, ShopAdminChatRoomDto, ShopAdminChatRoomSummaryDto, ShopAdminChatSide } from './dto/shop-admin-chat.dto.js';

/** Who is asking — read live from the session on every event, never cached on the socket. */
export interface ShopAdminChatViewer {
  readonly id: string;
  readonly role: UserRole;
}

/** What a write did, for the gateway to push — each side gets its own copy (`ShopAdminChatMessageDto.forSide`). */
export interface ShopAdminChatWrite {
  readonly message: ShopAdminChatMessage;
  readonly changed: boolean;
}

interface ShopInRoom {
  readonly id: string;
  readonly ownerId: string;
  readonly communityId: string;
  readonly name: string;
  readonly closedAt: Date | null;
  readonly approvalStatus: ShopApprovalStatus;
}

interface Access {
  readonly shop: ShopInRoom;
  readonly side: ShopAdminChatSide;
}

const SHOP_IN_ROOM = { id: true, ownerId: true, communityId: true, name: true, closedAt: true, approvalStatus: true } satisfies Prisma.ShopSelect;

const ROOMS_LIST_NAME = 'shopAdminChatRooms';
const messagesListName = (roomId: string): string => `shopAdminChatMessages:${roomId}`;
const versionsListName = (messageId: string): string => `shopAdminChatMessageVersions:${messageId}`;

/** L7's per-sender-per-room ceiling, counted apart from the buyer chat's. */
const rateLimitKey = (roomId: string, senderId: string): string => `shopAdminChat:send|${roomId}|${senderId}`;

/**
 * §106: the conversation between a shop and the admins of its community — one room per shop, a
 * shared inbox on the admins' side (see `ShopAdminChatRoom`'s schema comment and DECISIONS §106).
 *
 * Every method resolves the caller's side from live data before anything else (`accessTo*`): the
 * shop's owner is the `SHOP` side; an admin of the shop's community, or a super admin, is the
 * `ADMIN` side; anyone else gets the same `NOT_FOUND` a room that does not exist would — the
 * community wall of invariant 1, held here without a guard because a socket event never passes
 * through one. Owner first: someone who owns the shop never speaks for its admins about it (N28).
 */
@Injectable()
export class ShopAdminChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly files: FileStorageService,
    private readonly rateLimits: RateLimitService,
    private readonly config: AppConfig,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  /** Gets or creates the shop's one room — either side may be first. */
  async open(viewer: ShopAdminChatViewer, shopId: string): Promise<ShopAdminChatRoomDto> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: SHOP_IN_ROOM });
    const access = shop === null ? null : await this.sideOf(viewer, shop);
    if (shop === null || access === null) {
      throw new AppException('NOT_FOUND');
    }

    const room = await this.findOrCreateRoom(shop);

    return ShopAdminChatRoomDto.from(room, shop.communityId, access);
  }

  async join(viewer: ShopAdminChatViewer, roomId: string): Promise<ShopAdminChatRoomDto> {
    const { room, access } = await this.accessToRoom(viewer, roomId);

    return ShopAdminChatRoomDto.from(room, access.shop.communityId, access.side);
  }

  async send(viewer: ShopAdminChatViewer, roomId: string, content: string | undefined, fileId: string | undefined): Promise<{ message: ShopAdminChatMessage; side: ShopAdminChatSide }> {
    const { room, access } = await this.accessToRoom(viewer, roomId);
    requireOpenShop(access.shop);

    const trimmed = content?.trim() ?? '';
    if (trimmed.length === 0 && fileId === undefined) {
      throw new AppException('VALIDATION_FAILED', { fieldErrors: { content: 'พิมพ์ข้อความ หรือแนบรูปอย่างน้อยหนึ่งอย่าง' } });
    }
    await this.consumeRate(room.id, viewer.id);

    const message = await this.prisma.$transaction(async (tx) => {
      // §91: the sender's own words, overwritten by their erasure — written under the account's lock.
      await lockLiveAccount(tx, viewer.id);
      if (fileId !== undefined) {
        const claimed = await tx.shopAdminChatPendingAttachment.deleteMany({ where: { fileId, roomId: room.id, uploaderId: viewer.id } });
        if (claimed.count === 0) {
          throw new AppException('VALIDATION_FAILED', {
            fieldErrors: { fileId: 'รูปนี้ไม่ได้อัปโหลดไว้สำหรับห้องนี้ ถูกส่งไปแล้ว หรือหมดอายุแล้ว กรุณาอัปโหลดใหม่' },
          });
        }
      }
      // §108: the room rises to the top of both inboxes. Written before the notice check below, so
      // this row lock is held while it runs — `clearAdminNoticesIfCaughtUp` takes the same lock, and
      // a notice this send decides not to raise (one is still unread) cannot be cleared under it by
      // an admin who never saw this message.
      const now = this.clock.now();
      await tx.shopAdminChatRoom.update({ where: { id: room.id }, data: { lastActivityAt: now } });
      const created = await tx.shopAdminChatMessage.create({
        data: { id: newId(), roomId: room.id, senderId: viewer.id, senderSide: access.side, fileId: fileId ?? null, content: trimmed, createdAt: now },
      });
      await this.auditAdminWrite(tx, access, viewer.id, 'SHOP_ADMIN_CHAT_MESSAGE_SENT');
      await this.notifyOtherSide(tx, access);
      // §108: an admin's reply is the admins having handled it, whoever replied (the super admin
      // included), so their side reads as read.
      if (access.side === 'ADMIN') {
        await this.markReadUpTo(tx, room.id, 'ADMIN', created);
        await this.notifications.markReadForEveryone('SHOP_ADMIN_CHAT_FROM_SHOP', access.shop.id, tx);
      }

      return created;
    });

    return { message, side: access.side };
  }

  /**
   * §89's edit, for this room: the sender's own message, any time, every earlier text kept as a
   * version both sides can read. Saving the same text again is not an edit.
   */
  async edit(viewer: ShopAdminChatViewer, roomId: string, messageId: string, content: string): Promise<ShopAdminChatWrite & { side: ShopAdminChatSide }> {
    const { room, access } = await this.accessToRoom(viewer, roomId);
    requireOpenShop(access.shop);
    const own = await this.requireOwnMessage(room.id, viewer.id, access.side, messageId);
    requireNotUnsent(own);
    const next = content.trim();
    if (next.length === 0 && own.fileId === null) {
      throw new AppException('VALIDATION_FAILED', { fieldErrors: { content: 'ข้อความที่ไม่มีรูปแนบ ต้องมีตัวหนังสืออย่างน้อยหนึ่งตัว' } });
    }
    if (next === own.content) {
      return { message: own, changed: false, side: access.side };
    }
    await this.consumeRate(room.id, viewer.id);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockLiveAccount(tx, viewer.id);
      const current = await lockMessage(tx, own.id);
      requireNotUnsent(current);
      if (next === current.content) {
        return { message: current, changed: false };
      }

      const now = this.clock.now();
      if ((await tx.shopAdminChatMessageVersion.count({ where: { messageId: current.id } })) === 0) {
        await tx.shopAdminChatMessageVersion.create({ data: { id: newId(), messageId: current.id, content: current.content, writtenAt: current.createdAt } });
      }
      await tx.shopAdminChatMessageVersion.create({ data: { id: newId(), messageId: current.id, content: next, writtenAt: now } });
      const updated = await tx.shopAdminChatMessage.update({ where: { id: current.id }, data: { content: next, editedAt: now } });
      await this.auditAdminWrite(tx, access, viewer.id, 'SHOP_ADMIN_CHAT_MESSAGE_EDITED');

      return { message: updated, changed: true };
    });

    return { ...outcome, side: access.side };
  }

  /** §89's unsend: within `CHAT_UNSEND_WINDOW_MINUTES`, final, and the original stays for the admins. */
  async unsend(viewer: ShopAdminChatViewer, roomId: string, messageId: string): Promise<{ message: ShopAdminChatMessage; side: ShopAdminChatSide }> {
    const { room, access } = await this.accessToRoom(viewer, roomId);
    requireOpenShop(access.shop);
    const own = await this.requireOwnMessage(room.id, viewer.id, access.side, messageId);
    requireNotUnsent(own);

    const message = await this.prisma.$transaction(async (tx) => {
      const current = await lockMessage(tx, own.id);
      requireNotUnsent(current);
      const now = this.clock.now();
      if (now.getTime() > current.createdAt.getTime() + CHAT_UNSEND_WINDOW_MINUTES * MS_PER_MINUTE) {
        throw new AppException('CONFLICT', {
          message: `ยกเลิกการส่งได้ภายใน ${String(CHAT_UNSEND_WINDOW_MINUTES)} นาทีหลังส่งเท่านั้น ข้อความนี้ยังแก้ไขได้ และประวัติการแก้ไขจะแสดงให้อีกฝ่ายเห็น`,
        });
      }
      const updated = await tx.shopAdminChatMessage.update({ where: { id: current.id }, data: { unsentAt: now } });
      await this.auditAdminWrite(tx, access, viewer.id, 'SHOP_ADMIN_CHAT_MESSAGE_UNSENT');

      return updated;
    });

    return { message, side: access.side };
  }

  /** Newest first, and the read signal for this caller's side — the admins read as one inbox. */
  async listMessages(viewer: ShopAdminChatViewer, roomId: string, cursor: string | undefined, limit: number): Promise<Page<ShopAdminChatMessageDto>> {
    const { room, access } = await this.accessToRoom(viewer, roomId);
    const rows = await this.prisma.shopAdminChatMessage.findMany({
      where: { roomId: room.id, ...keysetAfter(cursor, messagesListName(room.id)) },
      orderBy: newestFirst(),
      take: limit + 1,
    });
    const page = toPage(rows, limit, messagesListName(room.id));
    if (countsAsReading(viewer, access.side)) {
      await this.markReadUpTo(this.prisma, room.id, access.side, page.items[0]);
      // §108: the first page is the newest messages — a community admin who has seen them has seen
      // what the other admins were told about, so their notices for this room go too.
      if (access.side === 'ADMIN' && (cursor === undefined || cursor === '')) {
        await this.clearAdminNoticesIfCaughtUp(room.id, access.shop.id, page.items[0]);
      }
    }

    return { ...page, items: page.items.map((row) => ShopAdminChatMessageDto.forSide(row, access.side)) };
  }

  /** Every text a message has shown. An unsent message has no history for the shop — admins still read it. */
  async listVersions(viewer: ShopAdminChatViewer, roomId: string, messageId: string, cursor: string | undefined, limit: number): Promise<Page<ChatMessageVersionDto>> {
    const { room, access } = await this.accessToRoom(viewer, roomId);
    const message = await this.prisma.shopAdminChatMessage.findFirst({
      where: { id: messageId, roomId: room.id, ...(access.side === 'SHOP' ? { unsentAt: null } : {}) },
    });
    if (message === null) {
      throw new AppException('NOT_FOUND');
    }

    const listName = versionsListName(message.id);
    const rows = await this.prisma.shopAdminChatMessageVersion.findMany({
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
   * The caller's inbox: the rooms of shops they own, and — as an admin — the rooms of every shop in
   * the communities they administer (all of them for a super admin). Newest activity first (§108);
   * each with its latest message and what this side has not read yet.
   */
  async listRooms(viewer: ShopAdminChatViewer, cursor: string | undefined, limit: number): Promise<Page<ShopAdminChatRoomSummaryDto>> {
    // A super admin's inbox is every room; anyone else's is their own shops' rooms plus those of the
    // communities they administer.
    let scope: Prisma.ShopAdminChatRoomWhereInput = {};
    if (viewer.role !== 'SUPER_ADMIN') {
      const communities = await this.prisma.communityAdmin.findMany({ where: { userId: viewer.id }, select: { communityId: true } });
      scope = { OR: [{ shop: { ownerId: viewer.id } }, { shop: { communityId: { in: communities.map((row) => row.communityId) } } }] };
    }

    // §108: newest activity first, so a shop that just wrote is on the first page, not below every
    // room opened since.
    const rows = await this.prisma.shopAdminChatRoom.findMany({
      where: { AND: [scope, keysetAfterActivity(cursor, ROOMS_LIST_NAME)] },
      include: { shop: { select: SHOP_IN_ROOM }, reads: true },
      orderBy: latestActivityFirst(),
      take: limit + 1,
    });
    const page = toActivityPage(rows, limit, ROOMS_LIST_NAME);

    const items = await Promise.all(
      page.items.map(async (room) => {
        const side: ShopAdminChatSide = room.shop.ownerId === viewer.id ? 'SHOP' : 'ADMIN';
        const lastReadAt = room.reads.find((read) => read.side === side)?.lastReadAt;
        const [last, unreadCount] = await Promise.all([
          this.prisma.shopAdminChatMessage.findFirst({ where: { roomId: room.id }, orderBy: { id: 'desc' } }),
          this.prisma.shopAdminChatMessage.count({
            where: { roomId: room.id, senderSide: { not: side }, ...(lastReadAt !== undefined ? { createdAt: { gt: lastReadAt } } : {}) },
          }),
        ]);
        const summary = new ShopAdminChatRoomSummaryDto();
        summary.id = room.id;
        summary.shopId = room.shopId;
        summary.shopName = room.shop.name;
        summary.communityId = room.shop.communityId;
        summary.createdAt = room.createdAt;
        summary.side = side;
        summary.lastMessage = last === null ? null : ShopAdminChatMessageDto.forSide(last, side);
        summary.unreadCount = unreadCount;

        return summary;
      }),
    );

    return { ...page, items };
  }

  /** A room this caller may upload into, with room for another pending picture — asked before the file is read (§100). */
  async requireAttachmentUploadable(viewer: ShopAdminChatViewer, roomId: string): Promise<void> {
    const { room, access } = await this.accessToRoom(viewer, roomId);
    requireOpenShop(access.shop);
    await requirePendingRoom(this.prisma, room.id, viewer.id);
  }

  /**
   * The same question for the upload route's pre-check (§100), which knows only the account id —
   * the role is read here, live, like everywhere else.
   */
  async requireAttachmentUploadableByUserId(userId: string, roomId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user === null) {
      throw new AppException('NOT_FOUND');
    }
    await this.requireAttachmentUploadable({ id: userId, role: user.role }, roomId);
  }

  async uploadAttachment(viewer: ShopAdminChatViewer, roomId: string, upload: UploadedTempFile): Promise<{ fileId: string }> {
    await this.requireAttachmentUploadable(viewer, roomId);
    // jpg/png only, re-encoded to strip EXIF (K1/K17) — never a document: a slip does not enter a chat.
    const stored = await this.files.storeImage(upload);

    try {
      await this.prisma.$transaction(async (tx) => {
        await lockLiveAccount(tx, viewer.id);
        await tx.$queryRaw`SELECT id FROM shop_admin_chat_room WHERE id = ${roomId}::uuid FOR UPDATE`;
        await requirePendingRoom(tx, roomId, viewer.id);
        await tx.shopAdminChatPendingAttachment.create({ data: { fileId: stored.id, roomId, uploaderId: viewer.id, createdAt: this.clock.now() } });
      });
    } catch (error) {
      await this.files.discardUnattached(stored.id);
      throw error;
    }

    return { fileId: stored.id };
  }

  /** A picture that is part of this room's history; an unsent one is gone for the shop, not for the admins. */
  async readAttachment(viewer: ShopAdminChatViewer, roomId: string, fileId: string): Promise<ReadImage> {
    const { room, access } = await this.accessToRoom(viewer, roomId);
    const message = await this.prisma.shopAdminChatMessage.findFirst({
      where: { roomId: room.id, fileId, ...(access.side === 'SHOP' ? { unsentAt: null } : {}) },
      select: { id: true },
    });
    const image = message === null ? null : await this.files.readImage(fileId);
    if (image === null) {
      throw new AppException('NOT_FOUND');
    }

    return image;
  }

  /** The 24-hour sweep's half for this chat (§83's twin): unsent uploads, row and bytes. */
  async discardExpiredPendingAttachments(now: Date): Promise<number> {
    const expired = { createdAt: { lte: addHours(now, -PENDING_CHAT_ATTACHMENT_TTL_HOURS) } } satisfies Prisma.ShopAdminChatPendingAttachmentWhereInput;
    const candidates = await this.prisma.shopAdminChatPendingAttachment.findMany({ where: expired, select: { fileId: true } });

    let discarded = 0;
    for (const { fileId } of candidates) {
      const claimed = await this.prisma.shopAdminChatPendingAttachment.deleteMany({ where: { fileId, ...expired } });
      if (claimed.count === 0) {
        continue;
      }
      await this.files.discardUnattached(fileId);
      discarded += 1;
    }

    return discarded;
  }

  /** The room ids of every shop in one community — for taking a removed admin's sockets out of them. */
  async roomIdsInCommunity(communityId: string): Promise<string[]> {
    const rooms = await this.prisma.shopAdminChatRoom.findMany({ where: { shop: { communityId } }, select: { id: true } });

    return rooms.map((room) => room.id);
  }

  private async accessToRoom(viewer: ShopAdminChatViewer, roomId: string): Promise<{ room: ShopAdminChatRoom; access: Access }> {
    const room = await this.prisma.shopAdminChatRoom.findUnique({ where: { id: roomId }, include: { shop: { select: SHOP_IN_ROOM } } });
    const side = room === null ? null : await this.sideOf(viewer, room.shop);
    if (room === null || side === null) {
      throw new AppException('NOT_FOUND');
    }

    return { room, access: { shop: room.shop, side } };
  }

  /** The owner is the shop's side; an admin of its community, or a super admin, the admins'; anyone else, nobody's. */
  private async sideOf(viewer: ShopAdminChatViewer, shop: ShopInRoom): Promise<ShopAdminChatSide | null> {
    if (shop.ownerId === viewer.id) {
      return 'SHOP';
    }

    // The community wall's one definition — the same function `CommunityScopeGuard` asks (invariant 1).
    return (await isAdminOfCommunity(this.prisma, viewer, shop.communityId)) ? 'ADMIN' : null;
  }

  private async findOrCreateRoom(shop: ShopInRoom): Promise<ShopAdminChatRoom> {
    const shopId = shop.id;
    const existing = await this.prisma.shopAdminChatRoom.findUnique({ where: { shopId } });
    if (existing !== null) {
      return existing;
    }
    // A shop its owner closed stays readable, but a first room for it would be a write with nothing to read.
    requireOpenShop(shop);
    try {
      const now = this.clock.now();
      return await this.prisma.shopAdminChatRoom.create({ data: { id: newId(), shopId, createdAt: now, lastActivityAt: now } });
    } catch (error) {
      // Both sides opening at the same instant: the unique key let one through, and its room is the one asked for.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.shopAdminChatRoom.findUniqueOrThrow({ where: { shopId } });
      }
      throw error;
    }
  }

  /** A message this caller sent from this side — anyone else's is NOT_FOUND, revealing nothing. */
  private async requireOwnMessage(roomId: string, senderId: string, side: ShopAdminChatSide, messageId: string): Promise<ShopAdminChatMessage> {
    const message = await this.prisma.shopAdminChatMessage.findFirst({ where: { id: messageId, roomId, senderId, senderSide: side } });
    if (message === null) {
      throw new AppException('NOT_FOUND');
    }

    return message;
  }

  private async consumeRate(roomId: string, senderId: string): Promise<void> {
    const outcome = await this.rateLimits.consume(rateLimitKey(roomId, senderId), this.config.rateLimitChatMessagePerMinute, MS_PER_MINUTE);
    if (!outcome.allowed) {
      throw new AppException('RATE_LIMITED');
    }
  }

  /** Invariant 1 (the owner's answer in §106): every admin write, in the same transaction — who, which shop, which community; never the words. */
  private async auditAdminWrite(
    tx: Prisma.TransactionClient,
    access: Access,
    actorUserId: string,
    action: 'SHOP_ADMIN_CHAT_MESSAGE_SENT' | 'SHOP_ADMIN_CHAT_MESSAGE_EDITED' | 'SHOP_ADMIN_CHAT_MESSAGE_UNSENT',
  ): Promise<void> {
    if (access.side !== 'ADMIN') {
      return;
    }
    await this.audit.record({ actorUserId, action, targetType: 'SHOP', targetId: access.shop.id, communityId: access.shop.communityId }, tx);
  }

  /**
   * In-app only, one unread notice per room (§84's shape): an admin's message tells the shop's owner;
   * the shop's tells every admin of its community (not the super admin — the §102 queue rule).
   * Written in the message's own transaction, so a failed notice cannot leave a saved message the
   * sender was told failed (and would send again) — the §105 review's lesson.
   */
  private async notifyOtherSide(tx: Prisma.TransactionClient, access: Access): Promise<void> {
    const { shop } = access;
    const recipients =
      access.side === 'ADMIN'
        ? [shop.ownerId]
        : // No buyer here: the owner fills both of the dispute-shaped parties, so no admin who owns this shop is told.
          await communityAdminsToNotify(tx, shop.communityId, { buyerId: shop.ownerId, shopOwnerId: shop.ownerId });
    const type = access.side === 'ADMIN' ? 'SHOP_ADMIN_CHAT_FROM_ADMIN' : 'SHOP_ADMIN_CHAT_FROM_SHOP';
    const message = access.side === 'ADMIN' ? 'แอดมินชุมชนส่งข้อความถึงร้านของคุณ' : 'ร้านในชุมชนที่คุณดูแลส่งข้อความถึงแอดมิน';

    for (const userId of recipients) {
      const unread = await tx.notification.findFirst({ where: { userId, type, targetId: shop.id, readAt: null }, select: { id: true } });
      if (unread === null) {
        await this.notifications.record({ userId, type, message, targetType: 'SHOP', targetId: shop.id }, tx);
      }
    }
  }

  /** Moves this side's marker to the newest message a page showed, never backwards (§83's rule). */
  private async markReadUpTo(
    client: Prisma.TransactionClient | PrismaService,
    roomId: string,
    side: ShopAdminChatSide,
    newestShown: ShopAdminChatMessage | undefined,
  ): Promise<void> {
    if (newestShown === undefined) {
      return;
    }
    const readUpTo = newestShown.createdAt;
    await client.shopAdminChatRead.upsert({
      where: { roomId_side: { roomId, side } },
      create: { id: newId(), roomId, side, lastReadAt: readUpTo },
      update: {},
    });
    await client.shopAdminChatRead.updateMany({ where: { roomId, side, lastReadAt: { lt: readUpTo } }, data: { lastReadAt: readUpTo } });
  }

  /**
   * §108 (the owner's choice): the community reads as one inbox, so one admin reading a room clears
   * every admin's notice for it — but only while nothing the shop wrote is newer than what that admin
   * was shown. One unread notice stands for every message after it (`notifyOtherSide` raises no
   * second one), so clearing it past a message nobody saw would leave that message with no notice at
   * all. The room lock is the one `send` holds while it decides whether to raise a notice.
   */
  private async clearAdminNoticesIfCaughtUp(roomId: string, shopId: string, newestShown: ShopAdminChatMessage | undefined): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM shop_admin_chat_room WHERE id = ${roomId}::uuid FOR NO KEY UPDATE`;
      const unseenFromShop = await tx.shopAdminChatMessage.count({
        where: { roomId, senderSide: 'SHOP', ...(newestShown === undefined ? {} : { createdAt: { gt: newestShown.createdAt } }) },
      });
      if (unseenFromShop === 0) {
        await this.notifications.markReadForEveryone('SHOP_ADMIN_CHAT_FROM_SHOP', shopId, tx);
      }
    });
  }
}

/**
 * §108 (the owner's choice): whether opening a room counts as reading it. The shop's owner, and a
 * community admin, yes. A super admin looking in, no — they oversee every community, and a glance
 * of theirs must not hide a waiting message from the admins who actually have to handle it. A
 * super admin who *replies* has handled it; `send` marks that.
 */
function countsAsReading(viewer: ShopAdminChatViewer, side: ShopAdminChatSide): boolean {
  return side === 'SHOP' || viewer.role !== 'SUPER_ADMIN';
}

/**
 * A shop its owner closed keeps a readable room, but neither side writes in it any more (§106).
 * Not a rejected one: `ShopService.reject` also sets `closedAt` (it frees the owner to apply again),
 * and a rejected applicant asking why is exactly what this chat is for — the owner's answer lists them.
 */
function requireOpenShop(shop: ShopInRoom): void {
  if (shop.closedAt !== null && shop.approvalStatus !== 'REJECTED') {
    throw new AppException('CONFLICT', { message: 'ร้านนี้ปิดแล้ว อ่านข้อความเก่าได้ แต่ส่งหรือแก้ข้อความใหม่ไม่ได้' });
  }
}

function requireNotUnsent(message: ShopAdminChatMessage): void {
  if (message.unsentAt !== null) {
    throw new AppException('CONFLICT', { message: 'ข้อความนี้ถูกยกเลิกการส่งแล้ว แก้ไขหรือยกเลิกซ้ำไม่ได้' });
  }
}

async function lockMessage(tx: Prisma.TransactionClient, messageId: string): Promise<ShopAdminChatMessage> {
  await tx.$queryRaw`SELECT id FROM shop_admin_chat_message WHERE id = ${messageId}::uuid FOR UPDATE`;
  return tx.shopAdminChatMessage.findUniqueOrThrow({ where: { id: messageId } });
}

async function requirePendingRoom(client: Prisma.TransactionClient | PrismaService, roomId: string, uploaderId: string): Promise<void> {
  const pending = await client.shopAdminChatPendingAttachment.count({ where: { roomId, uploaderId } });
  if (pending >= MAX_PENDING_CHAT_ATTACHMENTS_PER_UPLOADER) {
    throw new AppException('CONFLICT', {
      message: `มีรูปที่อัปโหลดไว้แต่ยังไม่ได้ส่งครบ ${String(MAX_PENDING_CHAT_ATTACHMENTS_PER_UPLOADER)} รูปแล้ว ส่งรูปที่ค้างอยู่ก่อน หรือรอให้ระบบล้างรูปที่ไม่ได้ส่ง (24 ชั่วโมง) แล้วค่อยอัปใหม่`,
    });
  }
}
