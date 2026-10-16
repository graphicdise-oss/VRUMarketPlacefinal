import { IsString, IsUUID, MaxLength } from 'class-validator';
import { MAX_CHAT_MESSAGE_LENGTH } from './send-message.dto.js';

/**
 * §89 `editMessage`: the text only. There is deliberately no `fileId` (a picture cannot be swapped
 * — the owner's choice) and no `orderId`; `validateWsBody`'s `forbidNonWhitelisted` turns either
 * into a VALIDATION_FAILED rather than silently ignoring it. `content` may be empty only on a
 * picture message — `ChatService.editMessage` checks that, the same rule `sendMessage` applies.
 */
export class EditMessageDto {
  @IsUUID()
  roomId!: string;

  @IsUUID()
  messageId!: string;

  @IsString()
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  content!: string;
}
