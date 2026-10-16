import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length } from 'class-validator';

/** Same bounds as `SuspendShopDto`'s reason — the same shape of admin decision. */
export const MIN_RULING_REASON_LENGTH = 10;
export const MAX_RULING_REASON_LENGTH = 500;

export const FROZEN_ORDER_VERDICTS = ['RELEASE', 'TERMINATE'] as const;
export type FrozenOrderVerdict = (typeof FROZEN_ORDER_VERDICTS)[number];

/**
 * #62 (I4): the admin's only two choices for a frozen order — never a destination. There is
 * deliberately no field here for *where* a `TERMINATE` verdict sends the order:
 * `class-validator`'s global `forbidNonWhitelisted` (src/bootstrap.ts) already rejects any extra
 * field a caller sends with a plain 400, which is what makes "an admin who tries to name a
 * destination gets refused" true without this DTO having to detect and reject it itself.
 */
export class RuleFrozenOrderDto {
  @ApiProperty({
    enum: FROZEN_ORDER_VERDICTS,
    description:
      'RELEASE: unfreeze and let the order continue exactly where it was (H3 gives its clock a ' +
      'fresh window). TERMINATE: the system — never the caller — picks CANCELLED for an unpaid ' +
      'order or REFUND_ORDERED for a paid one (H5’s own line).',
  })
  @IsEnum(FROZEN_ORDER_VERDICTS)
  verdict!: FrozenOrderVerdict;

  /**
   * `FROZEN_ORDER_RULED` is in `ACTIONS_REQUIRING_REASON` (prepared ahead of this ticket) —
   * I9/I9b make this the only explanation either party ever gets for what happened to their
   * order, since there is no appeal to ask for more.
   */
  @ApiProperty({
    minLength: MIN_RULING_REASON_LENGTH,
    maxLength: MAX_RULING_REASON_LENGTH,
    description: 'Recorded in audit_log — this is the only record of why the order was ruled this way.',
    example: 'ตรวจสอบแล้วร้านไม่ได้ทำผิดตามที่ถูกกล่าวหา จึงปล่อยให้ออเดอร์นี้ดำเนินการต่อตามปกติ',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_RULING_REASON_LENGTH, MAX_RULING_REASON_LENGTH)
  reason!: string;
}
