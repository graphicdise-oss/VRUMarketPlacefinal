import { ApiProperty } from '@nestjs/swagger';

/**
 * §89: one text a message has shown — the Messenger-style "edit history" entry. `writtenAt` is
 * when this text became the message's content: the message's own `createdAt` for the original,
 * the edit's time for every later one.
 */
export class ChatMessageVersionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ description: 'When this text became the message’s content.' })
  writtenAt!: Date;

  static of(id: string, content: string, writtenAt: Date): ChatMessageVersionDto {
    const dto = new ChatMessageVersionDto();
    dto.id = id;
    dto.content = content;
    dto.writtenAt = writtenAt;

    return dto;
  }
}
