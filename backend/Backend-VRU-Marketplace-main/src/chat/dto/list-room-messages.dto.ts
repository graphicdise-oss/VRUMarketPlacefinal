import { IsUUID } from 'class-validator';
import { WsPageQueryDto } from './ws-page-query.dto.js';

/** `listMessages`: a room's history, oldest first (see `ChatService.listMessages`). */
export class ListRoomMessagesDto extends WsPageQueryDto {
  @IsUUID()
  roomId!: string;
}
