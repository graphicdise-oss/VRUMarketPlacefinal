import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Shortest reason worth recording, and the longest anyone will read. */
export const MIN_BAN_REASON_LENGTH = 10;
export const MAX_BAN_REASON_LENGTH = 500;

export class BanUserDto {
  /**
   * Why. Required, and not for the person being banned — for whoever reads the audit log later.
   *
   * CLAUDE.md puts USER_BANNED in ACTIONS_REQUIRING_REASON, and the audit writer refuses an entry
   * without one. Validating it here as well means an admin gets a 400 explaining what is missing
   * instead of a 500 from a service that will not write the row.
   *
   * The minimum length exists because "spam" is not a reason anybody can act on in six months.
   * It is a low bar on purpose — a bar high enough to be annoying is a bar people type past.
   */
  @ApiProperty({
    minLength: MIN_BAN_REASON_LENGTH,
    maxLength: MAX_BAN_REASON_LENGTH,
    description:
      'Recorded in audit_log and never shown to the banned account. Write it for the person ' +
      'who has to review this decision later.',
    example: 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้ว 2 ครั้ง',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_BAN_REASON_LENGTH, MAX_BAN_REASON_LENGTH)
  reason!: string;
}
