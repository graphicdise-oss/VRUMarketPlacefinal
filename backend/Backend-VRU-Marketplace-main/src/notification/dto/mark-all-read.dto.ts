import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * §113: `POST /notifications/read-all`'s optional body. Without `upToId` every notice is marked
 * read, as before; with it, only that notice and older ones — so one that arrived after the screen
 * was drawn stays unread rather than being cleared unseen.
 */
export class MarkAllReadDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The newest notification id the screen showed. Ids are time-ordered (UUIDv7), so "older" is "smaller".',
  })
  @IsOptional()
  @IsUUID()
  upToId?: string;
}
