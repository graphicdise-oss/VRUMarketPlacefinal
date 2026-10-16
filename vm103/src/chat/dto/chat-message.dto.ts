import { ApiProperty } from '@nestjs/swagger';
import { ChatMessage } from '@prisma/client';

/**
 * One message, as either party — or, from #68 onward, break-glass admin — reads it.
 *
 * `fileId` is not the file's bytes (#67, K17): a client that sees it non-null fetches the image
 * from `GET /chat-rooms/:roomId/attachments/:fileId`, the same "id, then a separate authenticated
 * read" split every other upload in this system already uses (`PaymentSlipDto`, `ReviewImage`'s
 * own read route).
 *
 * §89: `editedAt` non-null means the text was changed — its earlier versions are one
 * `listMessageVersions` away. `unsentAt` non-null means the sender unsent it: the parties then get
 * an empty shell (`from`), and only a break-glass admin still sees what it said (`forAdmin`).
 */
export class ChatMessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  roomId!: string;

  @ApiProperty({ format: 'uuid' })
  senderId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  orderId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'Fetch the picture from GET /chat-rooms/:roomId/attachments/:fileId.' })
  fileId!: string | null;

  @ApiProperty({ description: 'Empty for an unsent message, except in the break-glass admin view.' })
  content!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true, type: Date, description: 'Non-null: the text was changed; its earlier versions are listed separately.' })
  editedAt!: Date | null;

  @ApiProperty({ nullable: true, type: Date, description: 'Non-null: the sender unsent it.' })
  unsentAt!: Date | null;

  @ApiProperty({ nullable: true, type: Boolean, description: 'True if read by the recipient.' })
  isRead?: boolean;

  /**
   * The parties' view — every party-facing path (the socket, the room list's last message) goes
   * through this one, so an unsent message's text, picture and order reference cannot leak
   * through a path that forgot to hide them.
   */
  static from(message: ChatMessage, isRead?: boolean): ChatMessageDto {
    const dto = ChatMessageDto.forAdmin(message);
    if (message.unsentAt !== null) {
      dto.content = '';
      dto.fileId = null;
      dto.orderId = null;
    }
    if (isRead !== undefined) {
      dto.isRead = isRead;
    }

    return dto;
  }

  /** #68/§89: break-glass only — the row exactly as stored, an unsent message's original included. */
  static forAdmin(message: ChatMessage): ChatMessageDto {
    const dto = new ChatMessageDto();
    dto.id = message.id;
    dto.roomId = message.roomId;
    dto.senderId = message.senderId;
    dto.orderId = message.orderId;
    dto.fileId = message.fileId;
    dto.content = message.content;
    dto.createdAt = message.createdAt;
    dto.editedAt = message.editedAt;
    dto.unsentAt = message.unsentAt;

    return dto;
  }
}
