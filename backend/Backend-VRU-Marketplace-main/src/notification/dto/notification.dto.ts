import { ApiProperty } from '@nestjs/swagger';
import { Notification } from '@prisma/client';
import { NOTIFICATION_TARGET_TYPES, NOTIFICATION_TYPES } from '../notification-type.js';

/** One notification, as its own owner reads it (#69) — nobody else can ever fetch this row. */
export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NOTIFICATION_TYPES })
  type!: string;

  @ApiProperty({ description: 'Thai text, ready to show as-is.' })
  message!: string;

  @ApiProperty({ enum: NOTIFICATION_TARGET_TYPES, nullable: true, type: String })
  targetType!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  targetId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true, type: Date, description: 'Null means unread.' })
  readAt!: Date | null;

  static from(row: Notification): NotificationDto {
    const dto = new NotificationDto();
    dto.id = row.id;
    dto.type = row.type;
    dto.message = row.message;
    dto.targetType = row.targetType;
    dto.targetId = row.targetId;
    dto.createdAt = row.createdAt;
    dto.readAt = row.readAt;

    return dto;
  }
}
