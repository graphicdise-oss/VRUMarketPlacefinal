import { Ack, ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { ShopAdminChatMessage } from '@prisma/client';
import type { Namespace } from 'socket.io';
import { SessionService } from '../auth/session.service.js';
import { AppException } from '../common/errors/app-exception.js';
import type { Page } from '../common/pagination/page.js';
import { CommunityAdminRevocations } from '../community/community-admin-revocations.js';
import { ChatMessageVersionDto } from './dto/chat-message-version.dto.js';
import { EditMessageDto } from './dto/edit-message.dto.js';
import { JoinRoomDto } from './dto/join-room.dto.js';
import { ListMessageVersionsDto } from './dto/list-message-versions.dto.js';
import { ListRoomMessagesDto } from './dto/list-room-messages.dto.js';
import {
  OpenShopAdminRoomDto,
  SendShopAdminMessageDto,
  ShopAdminChatMessageDto,
  ShopAdminChatRoomDto,
  ShopAdminChatRoomSummaryDto,
  ShopAdminChatSide,
} from './dto/shop-admin-chat.dto.js';
import { UnsendMessageDto } from './dto/unsend-message.dto.js';
import { WsPageQueryDto } from './dto/ws-page-query.dto.js';
import { ShopAdminChatService, ShopAdminChatViewer } from './shop-admin-chat.service.js';
import { validateWsBody } from './validate-ws-body.js';
import { requireLiveSocketUser } from './ws-auth.js';
import { respond } from './ws-respond.js';
import { CHAT_EVENT, shopAdminSocketRoom, userRoom, type AckCallback, type ChatSocket } from './ws-types.js';

const SIDES: readonly ShopAdminChatSide[] = ['SHOP', 'ADMIN'];

/**
 * §106: the admin↔shop chat's events, on the same `/chat` namespace and socket as the buyer chat —
 * `ChatGateway` registers the namespace's handshake (cookie auth, Origin, access log) once, and
 * every connection here has been through it. Kept in its own class so neither conversation's
 * rules leak into the other's handlers.
 *
 * Pushes go to one socket.io room *per side* (`shopAdminSocketRoom`), each with that side's copy
 * of the message: the shop is never told which admin wrote, nor what was unsent, so there is no
 * single payload both sides may receive.
 */
@WebSocketGateway({ namespace: '/chat', path: '/api/v1/socket.io' })
export class ShopAdminChatGateway implements OnGatewayInit {
  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    private readonly chat: ShopAdminChatService,
    private readonly sessions: SessionService,
    private readonly adminRevocations: CommunityAdminRevocations,
  ) {}

  /**
   * An admin removed from a community leaves that community's rooms on every socket they hold —
   * the listening half of "checked on every event" (the §83 reasoning, for admin rights).
   */
  afterInit(namespace: Namespace): void {
    this.adminRevocations.onRevoked(async (userId, communityId) => {
      const roomIds = await this.chat.roomIdsInCommunity(communityId);
      if (roomIds.length > 0) {
        namespace.in(userRoom(userId)).socketsLeave(roomIds.map((roomId) => shopAdminSocketRoom(roomId, 'ADMIN')));
      }
    });
  }

  @SubscribeMessage(CHAT_EVENT.openShopAdminRoom)
  async onOpen(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<ShopAdminChatRoomDto>): Promise<void> {
    await respond(ack, async () => {
      const viewer = await this.viewer(client);
      const dto = await validateWsBody(OpenShopAdminRoomDto, body);
      const room = await this.chat.open(viewer, dto.shopId);
      await this.joinChecked(client, viewer, room);

      return room;
    });
  }

  @SubscribeMessage(CHAT_EVENT.joinShopAdminRoom)
  async onJoin(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<ShopAdminChatRoomDto>): Promise<void> {
    await respond(ack, async () => {
      const viewer = await this.viewer(client);
      const dto = await validateWsBody(JoinRoomDto, body);
      const room = await this.chat.join(viewer, dto.roomId);
      await this.joinChecked(client, viewer, room);

      return room;
    });
  }

  @SubscribeMessage(CHAT_EVENT.sendShopAdminMessage)
  async onSend(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<ShopAdminChatMessageDto>): Promise<void> {
    await respond(ack, async () => {
      const viewer = await this.viewer(client);
      const dto = await validateWsBody(SendShopAdminMessageDto, body);
      const { message, side } = await this.chat.send(viewer, dto.roomId, dto.content, dto.fileId);
      this.push('shopAdminMessage', message);

      return ShopAdminChatMessageDto.forSide(message, side);
    });
  }

  @SubscribeMessage(CHAT_EVENT.editShopAdminMessage)
  async onEdit(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<ShopAdminChatMessageDto>): Promise<void> {
    await respond(ack, async () => {
      const viewer = await this.viewer(client);
      const dto = await validateWsBody(EditMessageDto, body);
      const { message, changed, side } = await this.chat.edit(viewer, dto.roomId, dto.messageId, dto.content);
      if (changed) {
        this.push('shopAdminMessageUpdated', message);
      }

      return ShopAdminChatMessageDto.forSide(message, side);
    });
  }

  @SubscribeMessage(CHAT_EVENT.unsendShopAdminMessage)
  async onUnsend(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<ShopAdminChatMessageDto>): Promise<void> {
    await respond(ack, async () => {
      const viewer = await this.viewer(client);
      const dto = await validateWsBody(UnsendMessageDto, body);
      const { message, side } = await this.chat.unsend(viewer, dto.roomId, dto.messageId);
      this.push('shopAdminMessageUpdated', message);

      return ShopAdminChatMessageDto.forSide(message, side);
    });
  }

  @SubscribeMessage(CHAT_EVENT.listShopAdminMessages)
  async onListMessages(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<Page<ShopAdminChatMessageDto>>): Promise<void> {
    await respond(ack, async () => {
      const viewer = await this.viewer(client);
      const dto = await validateWsBody(ListRoomMessagesDto, body);

      return this.chat.listMessages(viewer, dto.roomId, dto.cursor, dto.limit);
    });
  }

  @SubscribeMessage(CHAT_EVENT.listShopAdminMessageVersions)
  async onListVersions(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<Page<ChatMessageVersionDto>>): Promise<void> {
    await respond(ack, async () => {
      const viewer = await this.viewer(client);
      const dto = await validateWsBody(ListMessageVersionsDto, body);

      return this.chat.listVersions(viewer, dto.roomId, dto.messageId, dto.cursor, dto.limit);
    });
  }

  @SubscribeMessage(CHAT_EVENT.listShopAdminRooms)
  async onListRooms(@MessageBody() body: unknown, @ConnectedSocket() client: ChatSocket, @Ack() ack: AckCallback<Page<ShopAdminChatRoomSummaryDto>>): Promise<void> {
    await respond(ack, async () => {
      const viewer = await this.viewer(client);
      const dto = await validateWsBody(WsPageQueryDto, body);

      return this.chat.listRooms(viewer, dto.cursor, dto.limit);
    });
  }

  /**
   * Joins the socket to its side's room, then asks again: an admin removed between the first check
   * and the join would otherwise land in the room *after* the removal emptied it, and a socket that
   * only listens is never asked again. Checked after joining, the removal is seen either way.
   */
  private async joinChecked(client: ChatSocket, viewer: ShopAdminChatViewer, room: ShopAdminChatRoomDto): Promise<void> {
    const socketRoom = shopAdminSocketRoom(room.id, room.side);
    await client.join(socketRoom);
    try {
      const again = await this.chat.join(viewer, room.id);
      if (again.side !== room.side) {
        throw new AppException('NOT_FOUND');
      }
    } catch (error) {
      await client.leave(socketRoom);
      throw error;
    }
  }

  /** Each side's socket room gets that side's copy — the only way the shop's copy can differ from the admins'. */
  private push(event: 'shopAdminMessage' | 'shopAdminMessageUpdated', message: ShopAdminChatMessage): void {
    for (const side of SIDES) {
      this.server.to(shopAdminSocketRoom(message.roomId, side)).emit(event, ShopAdminChatMessageDto.forSide(message, side));
    }
  }

  private async viewer(client: ChatSocket): Promise<ShopAdminChatViewer> {
    const user = await requireLiveSocketUser(this.sessions, client);

    return { id: user.id, role: user.role };
  }
}
