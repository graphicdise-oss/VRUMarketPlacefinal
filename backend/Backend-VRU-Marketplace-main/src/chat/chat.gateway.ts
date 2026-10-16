import { Logger } from '@nestjs/common';
import { Ack, ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import cookieParser from 'cookie-parser';
import type { Namespace } from 'socket.io';
import { createAccessLogSocketMiddleware } from '../access-log/access-log-socket.js';
import { AccessLogService } from '../access-log/access-log.service.js';
import type { CurrentUser } from '../auth/authenticated-request.js';
import { SessionRevocations } from '../auth/session-revocations.js';
import { SessionService } from '../auth/session.service.js';
import type { Page } from '../common/pagination/page.js';
import { AppConfig } from '../config/app-config.module.js';
import { Clock } from '../time/clock.js';
import { ChatService } from './chat.service.js';
import { ChatMessageVersionDto } from './dto/chat-message-version.dto.js';
import { ChatMessageDto } from './dto/chat-message.dto.js';
import { ChatRoomSummaryDto } from './dto/chat-room-summary.dto.js';
import { ChatRoomDto } from './dto/chat-room.dto.js';
import { EditMessageDto } from './dto/edit-message.dto.js';
import { JoinRoomDto } from './dto/join-room.dto.js';
import { ListMessageVersionsDto } from './dto/list-message-versions.dto.js';
import { ListRoomMessagesDto } from './dto/list-room-messages.dto.js';
import { OpenRoomWithShopDto } from './dto/open-room-with-shop.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { UnsendMessageDto } from './dto/unsend-message.dto.js';
import { WsPageQueryDto } from './dto/ws-page-query.dto.js';
import { validateWsBody } from './validate-ws-body.js';
import { createChatAuthMiddleware, requireLiveSocketUser } from './ws-auth.js';
import { respond } from './ws-respond.js';
import { CHAT_EVENT, sessionRoom, userRoom, type AckCallback, type ChatSocket } from './ws-types.js';

/**
 * The only WebSocket surface in this system (#12/#66).
 *
 * Namespace `/chat` rather than the root, so a later feature that genuinely needs a socket (none
 * is planned) is not forced to share this one's auth middleware and CORS options by accident.
 *
 * Every event is request/response — a client always passes an ack callback and always gets one
 * back, success or failure, through `respond()` — rather than the fire-and-forget broadcast
 * style `@SubscribeMessage`'s auto-ack normally suggests. `message` is the one exception: it is
 * pushed to every socket in a room (including the sender's other tabs) when `sendMessage`
 * succeeds, which is how the *other* party learns about it without polling.
 */
@WebSocketGateway({
  namespace: '/chat',
  // ⚠️ Not engine.io's default `/socket.io/`. `cookies.ts` scopes the access-token cookie to
  // `Path=/api/v1` (B3) specifically so this handshake — a plain HTTP request under the hood —
  // can read it; a browser only attaches a cookie to a request whose path falls under the
  // cookie's own path, WebSocket handshakes included. Leaving this at the default would mean the
  // cookie never arrives here at all, in production exactly as much as in a test.
  path: '/api/v1/socket.io',
})
export class ChatGateway implements OnGatewayInit {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    private readonly chat: ChatService,
    private readonly sessions: SessionService,
    private readonly revocations: SessionRevocations,
    private readonly accessLog: AccessLogService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  /**
   * `@WebSocketServer()` binds to the **namespace** object here, not the root `Server` — Nest's
   * `IoAdapter.create()` calls `.of('/chat')` on the root server whenever a gateway names a
   * namespace, and that namespace is what gets injected. CORS is configured once, on the root
   * server, in `ChatIoAdapter` (decorator options are evaluated before DI exists, so `AppConfig`
   * cannot reach them here).
   *
   * `namespace.server.engine.use(cookieParser())` runs cookie-parser as engine.io middleware
   * against the raw handshake request, for both the polling and the websocket transport — the
   * WebSocket-side twin of `bootstrap.ts`'s `app.use(cookieParser())`, which is what makes
   * `socket.request.cookies` exist by the time `ws-auth.ts` reads it. Reached through
   * `.server` (the namespace's back-reference to the root `Server`) because engine.io itself has
   * no concept of namespaces — the HTTP upgrade it handles happens before any namespace routing.
   * Registered from this, the only gateway in the system, rather than from a dedicated
   * "root gateway": if a second WebSocket feature is ever added, this comment is the pointer to
   * move it somewhere shared.
   *
   * `namespace.use(...)` is namespace middleware, which socket.io runs on **every** connection
   * attempt to `/chat` — including a client's reconnect, which is a new low-level connection, not
   * a resumed one. That is the entire mechanism behind "checked at connect and at reconnect"
   * (invariant 8): there is no second code path, because socket.io does not offer one.
   *
   * Code review of topic 11 (§83): connect, reconnect and every event were covered, but a socket
   * that only *listens* never makes a call to be refused on — a banned or logged-out user kept
   * receiving every new message in the rooms they had joined. The listener below closes it: the
   * handshake put each socket in its session's room (`ws-auth.ts`), and whenever `SessionService`
   * ends sessions — logout, ban, password reset, erasure — every socket opened on them is
   * disconnected on the spot. This is socket.io's own documented pattern for logout
   * (`io.in(sessionRoom).disconnectSockets()`), and it closes only the session that ended: the
   * same person signed in on another device keeps that device's connection.
   */
  afterInit(namespace: Namespace): void {
    namespace.server.engine.use(cookieParser());
    namespace.use(createChatAuthMiddleware(this.sessions));
    // §98: after the auth check, so every row names the account it proved.
    namespace.use(createAccessLogSocketMiddleware(this.accessLog, this.clock, this.config.trustProxyHops));
    this.revocations.onRevoked((sessionIds) => {
      namespace.in(sessionIds.map(sessionRoom)).disconnectSockets(true);
    });
    this.logger.log('Chat gateway ready on namespace /chat');
  }

  @SubscribeMessage(CHAT_EVENT.openRoomWithShop)
  async onOpenRoomWithShop(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<ChatRoomDto>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const dto = await validateWsBody(OpenRoomWithShopDto, body);
      const room = await this.chat.openRoomWithShop(user, dto.shopId);
      await client.join(room.id);

      return room;
    });
  }

  @SubscribeMessage(CHAT_EVENT.joinRoom)
  async onJoinRoom(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<ChatRoomDto>): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const dto = await validateWsBody(JoinRoomDto, body);
      const room = await this.chat.getRoomForParty(user.id, dto.roomId);
      await client.join(room.id);

      return room;
    });
  }

  @SubscribeMessage(CHAT_EVENT.sendMessage)
  async onSendMessage(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<ChatMessageDto>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const dto = await validateWsBody(SendMessageDto, body);
      const message = await this.chat.sendMessage(user.id, dto.roomId, dto.content, dto.orderId, dto.fileId);

      // Every socket in the room, sender included — a second tab of the same person must see its
      // own message the identical way an offline party will see it on reconnect (#12's testing
      // decisions #4/#5). The ack above is the sender's confirmation that the write happened; this
      // is the live push to whoever else (or whatever else) is already in the room.
      this.server.to(message.roomId).emit('message', message);

      return message;
    });
  }

  /**
   * §89. `messageUpdated` carries the whole message as the parties see it, the same shape as
   * `message` — a client replaces its copy by id. Pushed to every socket in the room, sender
   * included, for the same reason `sendMessage` pushes `message` to the sender's other tabs.
   */
  @SubscribeMessage(CHAT_EVENT.editMessage)
  async onEditMessage(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<ChatMessageDto>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const dto = await validateWsBody(EditMessageDto, body);
      const { message, changed } = await this.chat.editMessage(user.id, dto.roomId, dto.messageId, dto.content);
      // Saving the same text again is not an edit (§89), so the room hears nothing about it.
      if (changed) {
        this.server.to(message.roomId).emit('messageUpdated', message);
      }

      return message;
    });
  }

  /** §89 — the same `messageUpdated` push, now with `unsentAt` set and the contents emptied. */
  @SubscribeMessage(CHAT_EVENT.unsendMessage)
  async onUnsendMessage(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<ChatMessageDto>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const dto = await validateWsBody(UnsendMessageDto, body);
      const message = await this.chat.unsendMessage(user.id, dto.roomId, dto.messageId);
      this.server.to(message.roomId).emit('messageUpdated', message);

      return message;
    });
  }

  @SubscribeMessage(CHAT_EVENT.listMessageVersions)
  async onListMessageVersions(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<Page<ChatMessageVersionDto>>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const dto = await validateWsBody(ListMessageVersionsDto, body);

      return this.chat.listMessageVersions(user.id, dto.roomId, dto.messageId, dto.cursor, dto.limit);
    });
  }

  @SubscribeMessage(CHAT_EVENT.listMessages)
  async onListMessages(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<Page<ChatMessageDto>>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const dto = await validateWsBody(ListRoomMessagesDto, body);

      const page = await this.chat.listMessages(user.id, dto.roomId, dto.cursor, dto.limit);
      this.server.to(dto.roomId).emit('roomRead', { roomId: dto.roomId, userId: user.id, readAt: this.clock.now() });

      return page;
    });
  }

  @SubscribeMessage(CHAT_EVENT.listRooms)
  async onListRooms(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<Page<ChatRoomSummaryDto>>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const dto = await validateWsBody(WsPageQueryDto, body);

      return this.chat.listRoomsForUser(user.id, dto.cursor, dto.limit);
    });
  }

  @SubscribeMessage(CHAT_EVENT.typing)
  async onTyping(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<void>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { roomId } = (body as { roomId?: string }) || {};
      if (roomId) {
        client.to(roomId).emit('userTyping', { roomId, userId: user.id });
      }
    });
  }

  @SubscribeMessage(CHAT_EVENT.stopTyping)
  async onStopTyping(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<void>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { roomId } = (body as { roomId?: string }) || {};
      if (roomId) {
        client.to(roomId).emit('userStopTyping', { roomId, userId: user.id });
      }
    });
  }

  @SubscribeMessage(CHAT_EVENT.markRoomRead)
  async onMarkRoomRead(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<{ readAt: Date }>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { roomId } = (body as { roomId: string }) || {};
      const room = await this.chat.getRoomForParty(user.id, roomId);
      const now = this.clock.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- synthesized newest message marker
      await this.chat.markReadUpTo(user.id, room.id, { createdAt: now } as any);
      this.server.to(room.id).emit('roomRead', { roomId: room.id, userId: user.id, readAt: now });
      return { readAt: now };
    });
  }

  @SubscribeMessage(CHAT_EVENT.checkOnline)
  async onCheckOnline(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<{ isOnline: boolean }>,
  ): Promise<void> {
    await respond(ack, async () => {
      await this.requireLiveUser(client);
      const { userId } = (body as { userId?: string }) || {};
      if (!userId) return { isOnline: false };
      const roomSockets = this.server.adapter.rooms.get(userRoom(userId));
      return { isOnline: (roomSockets?.size ?? 0) > 0 };
    });
  }

  @SubscribeMessage(CHAT_EVENT.blockUser)
  async onBlockUser(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<void>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { targetUserId } = (body as { targetUserId: string }) || {};
      await this.chat.blockUser(user.id, targetUserId);
    });
  }

  @SubscribeMessage(CHAT_EVENT.unblockUser)
  async onUnblockUser(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<void>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { targetUserId } = (body as { targetUserId: string }) || {};
      await this.chat.unblockUser(user.id, targetUserId);
    });
  }

  @SubscribeMessage(CHAT_EVENT.reportRoom)
  async onReportRoom(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<{ id: string }>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { roomId, reason, details, messageId } = (body as { roomId: string; reason: string; details?: string; messageId?: string }) || {};
      return this.chat.reportRoom(user.id, roomId, reason, details, messageId);
    });
  }

  @SubscribeMessage(CHAT_EVENT.hideMessage)
  async onHideMessage(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<void>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { roomId, messageId } = (body as { roomId: string; messageId: string }) || {};
      await this.chat.hideMessage(user.id, roomId, messageId);
    });
  }

  @SubscribeMessage(CHAT_EVENT.clearRoom)
  async onClearRoom(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<void>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { roomId } = (body as { roomId: string }) || {};
      await this.chat.clearRoom(user.id, roomId);
    });
  }

  @SubscribeMessage(CHAT_EVENT.searchMessages)
  async onSearchMessages(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: ChatSocket,
    @Ack() ack: AckCallback<ChatMessageDto[]>,
  ): Promise<void> {
    await respond(ack, async () => {
      const user = await this.requireLiveUser(client);
      const { roomId, query } = (body as { roomId: string; query: string }) || {};
      return this.chat.searchMessages(user.id, roomId, query || '');
    });
  }

  /** Every event re-reads the account from the database first — see `requireLiveSocketUser`. */
  private requireLiveUser(client: ChatSocket): Promise<CurrentUser> {
    return requireLiveSocketUser(this.sessions, client);
  }
}
