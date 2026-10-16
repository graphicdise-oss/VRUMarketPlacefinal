import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** L7. Exported so a test cannot drift from what the DTO actually enforces. */
export const MAX_CHAT_MESSAGE_LENGTH = 2000;

/**
 * `sendMessage`. `orderId` is optional and outside the room's identity on purpose (F4) — a
 * message can reference an order for context, but nothing about sending one requires one to
 * exist. `ChatService` still checks a supplied `orderId` actually belongs to this exact pair
 * before accepting it, so a message cannot be made to point at somebody else's order.
 *
 * `content` is optional here (#67, K17) — a picture needs no caption — but not unconditionally:
 * `ChatService.sendMessage` rejects a message with neither `content` nor `fileId`, since the DTO
 * layer has no way to see `fileId`'s value while validating `content`'s. `fileId` itself is not
 * validated further here; it comes from `POST /chat-rooms/:roomId/attachments`, and `ChatService`
 * checks it names a real, uploaded file.
 *
 * The 30-messages-a-minute half of L7 is not a DTO concern — see `ChatService.sendMessage`'s own
 * rate-limit check, which runs after this validates successfully.
 */
export class SendMessageDto {
  @IsUUID()
  roomId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  content?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  fileId?: string;
}
