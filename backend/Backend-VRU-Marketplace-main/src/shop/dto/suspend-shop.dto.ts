import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Same bounds as `BanUserDto`'s reason and `RejectShopDto`'s — the same shape of decision. */
export const MIN_SUSPENSION_REASON_LENGTH = 10;
export const MAX_SUSPENSION_REASON_LENGTH = 500;

export class SuspendShopDto {
  /**
   * Why. Required — `SHOP_SUSPENDED` is in `ACTIONS_REQUIRING_REASON` already (prepared ahead of
   * this ticket, back when #30 first listed the shop actions). Recorded in `audit_log`; unlike a
   * rejection's reason it is not surfaced on `GET /shops/me` — the owner sees *that* they are
   * suspended (`suspendedAt`), which is what J2 requires them to be able to act on, but not the
   * admin's private reasoning. Whether it should be shown too is a product decision nobody has
   * asked for yet, not a gap this ticket left by accident.
   */
  @ApiProperty({
    minLength: MIN_SUSPENSION_REASON_LENGTH,
    maxLength: MAX_SUSPENSION_REASON_LENGTH,
    description: 'Recorded in audit_log.',
    example: 'ได้รับข้อร้องเรียนเรื่องสินค้าไม่ตรงปกซ้ำหลายครั้งภายในสัปดาห์เดียว',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_SUSPENSION_REASON_LENGTH, MAX_SUSPENSION_REASON_LENGTH)
  reason!: string;
}
