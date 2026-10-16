import { ApiProperty } from '@nestjs/swagger';
import { DisputeDto } from './dispute.dto.js';

/**
 * §102: a dispute as the admin who has to rule on it sees it — the parties' own record (reason,
 * the shop's answer, the evidence list, any ruling) plus what the admin needs to get to the rest:
 * the community it belongs to, and the chat room between its two parties, if they ever talked.
 * No name, address, phone or slip here — those stay behind break-glass (I5).
 */
export class DisputeAdminDto extends DisputeDto {
  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ format: 'uuid' })
  communityId!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'The room between this order’s buyer and its shop’s owner, for GET /chat-rooms/:roomId/admin/messages — null if they never opened one.',
  })
  chatRoomId!: string | null;

  static fromCase(
    row: Parameters<typeof DisputeDto.from>[0] & { shopId: string; shop: { communityId: string } },
    chatRoomId: string | null,
  ): DisputeAdminDto {
    const dto = Object.assign(new DisputeAdminDto(), DisputeDto.from(row));
    dto.shopId = row.shopId;
    dto.communityId = row.shop.communityId;
    dto.chatRoomId = chatRoomId;

    return dto;
  }
}
