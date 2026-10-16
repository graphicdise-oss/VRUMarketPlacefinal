import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export const MIN_REVEAL_REASON_LENGTH = 10;
export const MAX_REVEAL_REASON_LENGTH = 500;

/** #64 (break-glass): why this admin needed to see this order's PII — `DISPUTE_IDENTITY_REVEALED` requires one. */
export class RevealIdentityDto {
  @ApiProperty({
    minLength: MIN_REVEAL_REASON_LENGTH,
    maxLength: MAX_REVEAL_REASON_LENGTH,
    example: 'ต้องดูที่อยู่จัดส่งจริงเทียบกับที่ผู้ซื้อร้องเรียนว่าได้รับของผิดที่',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_REVEAL_REASON_LENGTH, MAX_REVEAL_REASON_LENGTH)
  reason!: string;
}
