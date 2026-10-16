import { ShopAdminChatMessage, ShopAdminChatRoom } from '@prisma/client';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MAX_CHAT_MESSAGE_LENGTH } from './send-message.dto.js';

/** §106: which side of the admin↔shop chat the caller is on — decided per room, from live data. */
export type ShopAdminChatSide = 'SHOP' | 'ADMIN';

/** §106 `openShopAdminRoom`: the shop whose conversation to open — the owner's own, or one an admin oversees. */
export class OpenShopAdminRoomDto {
  @IsUUID()
  shopId!: string;
}

/** §106 `sendShopAdminMessage`: text, a picture from the upload route, or both — no order reference. */
export class SendShopAdminMessageDto {
  @IsUUID()
  roomId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  content?: string;

  @IsOptional()
  @IsUUID()
  fileId?: string;
}

/** §106: a room, and which side the caller reads it from. */
export class ShopAdminChatRoomDto {
  id!: string;
  shopId!: string;
  communityId!: string;
  createdAt!: Date;
  side!: ShopAdminChatSide;

  static from(room: ShopAdminChatRoom, communityId: string, side: ShopAdminChatSide): ShopAdminChatRoomDto {
    const dto = new ShopAdminChatRoomDto();
    dto.id = room.id;
    dto.shopId = room.shopId;
    dto.communityId = communityId;
    dto.createdAt = room.createdAt;
    dto.side = side;

    return dto;
  }
}

/**
 * §106: one message as one side reads it. Every path to a reader goes through `forSide`, so the two
 * things the shop must not see cannot leak through one that forgot: which admin wrote (`senderId`
 * is null on the shop's copy of an admin's message), and what an unsent message said.
 */
export class ShopAdminChatMessageDto {
  id!: string;
  roomId!: string;
  senderSide!: ShopAdminChatSide;
  senderId!: string | null;
  fileId!: string | null;
  content!: string;
  createdAt!: Date;
  editedAt!: Date | null;
  unsentAt!: Date | null;

  static forSide(message: ShopAdminChatMessage, side: ShopAdminChatSide): ShopAdminChatMessageDto {
    const dto = new ShopAdminChatMessageDto();
    dto.id = message.id;
    dto.roomId = message.roomId;
    dto.senderSide = message.senderSide as ShopAdminChatSide;
    dto.senderId = message.senderId;
    dto.fileId = message.fileId;
    dto.content = message.content;
    dto.createdAt = message.createdAt;
    dto.editedAt = message.editedAt;
    dto.unsentAt = message.unsentAt;

    if (side === 'SHOP') {
      // The owner's answer: the shop hears from "the community's admins", never from a named one.
      if (dto.senderSide === 'ADMIN') {
        dto.senderId = null;
      }
      // Unsent: an empty shell for the shop; every admin still reads the original (the owner's answer).
      if (message.unsentAt !== null) {
        dto.content = '';
        dto.fileId = null;
      }
    }

    return dto;
  }
}

/** §106: one row of an inbox — the room, its shop, its latest message and what this side has not read. */
export class ShopAdminChatRoomSummaryDto {
  id!: string;
  shopId!: string;
  shopName!: string;
  communityId!: string;
  createdAt!: Date;
  side!: ShopAdminChatSide;
  lastMessage!: ShopAdminChatMessageDto | null;
  unreadCount!: number;
}
