import { ApiProperty } from '@nestjs/swagger';

/** `GET /notifications/unread-count`'s response — one number, nothing else. */
export class UnreadCountDto {
  @ApiProperty({ minimum: 0 })
  count!: number;

  static of(count: number): UnreadCountDto {
    const dto = new UnreadCountDto();
    dto.count = count;

    return dto;
  }
}
