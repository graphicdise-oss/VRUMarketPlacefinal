import { ChatRoom } from '@prisma/client';

/**
 * A room as either party sees it.
 *
 * Deliberately minimal — no shop name, no display name for either side. K14 bound this to the
 * owner's `User`, which has no name anywhere in this schema (a shop's name lives on `Shop`,
 * which this room outlives on purpose), and #66's own AC never asks for one. Attaching a "best
 * guess at a label" here would be a decision nobody made: the frontend already has
 * `GET /shops/{id}` and `GET /shops/me` to resolve a friendly name for whichever party it is
 * rendering, and can decide for itself what a closed shop's room should read (see
 * `docs/FRONTEND-NOTES.md`).
 */
export class ChatRoomDto {
  id!: string;
  buyerId!: string;
  shopOwnerUserId!: string;
  createdAt!: Date;

  static from(room: ChatRoom): ChatRoomDto {
    const dto = new ChatRoomDto();
    dto.id = room.id;
    dto.buyerId = room.buyerId;
    dto.shopOwnerUserId = room.shopOwnerUserId;
    dto.createdAt = room.createdAt;

    return dto;
  }
}
