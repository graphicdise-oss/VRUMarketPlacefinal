import { IsUUID } from 'class-validator';
import { WsPageQueryDto } from './ws-page-query.dto.js';

/** §89 `listMessageVersions`: every text a message has shown, newest first, paged like every other list. */
export class ListMessageVersionsDto extends WsPageQueryDto {
  @IsUUID()
  roomId!: string;

  @IsUUID()
  messageId!: string;
}
