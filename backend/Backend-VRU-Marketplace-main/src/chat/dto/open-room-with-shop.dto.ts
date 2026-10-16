import { IsUUID } from 'class-validator';

/**
 * `openRoomWithShop`: the entrypoint a buyer uses before any order exists (F4). The client only
 * ever knows a shop's id (from a shop or product page) — resolving that to the owner's `User` id
 * that a room is actually keyed on (K14) is `ChatService`'s job, not something the caller does.
 */
export class OpenRoomWithShopDto {
  @IsUUID()
  shopId!: string;
}
