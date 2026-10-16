import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MAX_BAN_REASON_LENGTH, MIN_BAN_REASON_LENGTH } from './ban-user.dto.js';

export class EraseUserDto {
  /**
   * §86: which request this erasure answers. An erasure cannot be undone, and the account holder is
   * not the one pressing the button — so the audit row has to say what the admin acted on (the PDPA
   * request's reference, how it arrived). Same bounds as a ban reason: long enough to be traceable,
   * short enough to read.
   */
  @ApiProperty({
    minLength: MIN_BAN_REASON_LENGTH,
    maxLength: MAX_BAN_REASON_LENGTH,
    description:
      'Recorded in audit_log (ACCOUNT_ERASURE_REQUESTED, and SHOP_CLOSED if the erasure closes the shop).',
    example: 'คำขอลบข้อมูลตาม PDPA เลขที่ 2026-001 ส่งทางอีเมลถึงผู้ดูแลระบบ',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_BAN_REASON_LENGTH, MAX_BAN_REASON_LENGTH)
  reason!: string;
}
