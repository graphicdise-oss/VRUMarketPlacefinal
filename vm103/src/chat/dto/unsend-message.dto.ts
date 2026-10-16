import { IsUUID } from 'class-validator';

/** §89 `unsendMessage`: the sender's own message, within `CHAT_UNSEND_WINDOW_MINUTES` of sending. */
export class UnsendMessageDto {
  @IsUUID()
  roomId!: string;

  @IsUUID()
  messageId!: string;
}
