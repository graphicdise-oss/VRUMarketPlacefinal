import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length } from 'class-validator';

export const MIN_RULING_REASON_LENGTH = 10;
export const MAX_RULING_REASON_LENGTH = 2000;

export const DISPUTE_VERDICTS = ['BUYER_WINS', 'SHOP_WINS'] as const;
export type DisputeVerdictValue = (typeof DISPUTE_VERDICTS)[number];

/** #64 (K12): the admin's ruling — a verdict and the reason both sides will read. */
export class RuleDisputeDto {
  @ApiProperty({ enum: DISPUTE_VERDICTS })
  @IsEnum(DISPUTE_VERDICTS)
  verdict!: DisputeVerdictValue;

  @ApiProperty({
    minLength: MIN_RULING_REASON_LENGTH,
    maxLength: MAX_RULING_REASON_LENGTH,
    description: 'Shown to both the buyer and the shop — I9 cut the appeal process, so this is the only explanation either side gets.',
    example: 'จากหลักฐานทั้งสองฝ่าย สินค้าที่ส่งไม่ตรงตามที่ตกลงไว้จริง ผู้ซื้อจึงเป็นฝ่ายถูก',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_RULING_REASON_LENGTH, MAX_RULING_REASON_LENGTH)
  reason!: string;
}
