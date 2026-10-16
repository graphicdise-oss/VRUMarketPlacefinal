import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MAX_DISPUTE_REASON_LENGTH, MIN_DISPUTE_REASON_LENGTH } from '../common/dispute-policy.js';

/**
 * #63: the text half of opening a dispute — arrives as a multipart form field alongside `files`,
 * never JSON, since evidence is mandatory at open time (an admin should never have to chase down
 * "the file that was supposed to come with this").
 */
export class OpenDisputeDto {
  @ApiProperty({
    minLength: MIN_DISPUTE_REASON_LENGTH,
    maxLength: MAX_DISPUTE_REASON_LENGTH,
    example: 'สินค้าที่ได้รับไม่ตรงกับที่สั่ง สีและขนาดผิดทั้งคู่ ตามรูปที่แนบ',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_DISPUTE_REASON_LENGTH, MAX_DISPUTE_REASON_LENGTH)
  reason!: string;
}
