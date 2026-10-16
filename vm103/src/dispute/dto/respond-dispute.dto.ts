import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MAX_SHOP_RESPONSE_LENGTH, MIN_SHOP_RESPONSE_LENGTH } from '../common/dispute-policy.js';

/** #63: the shop's own account, set once — same multipart-alongside-`files` shape as opening. */
export class RespondDisputeDto {
  @ApiProperty({
    minLength: MIN_SHOP_RESPONSE_LENGTH,
    maxLength: MAX_SHOP_RESPONSE_LENGTH,
    example: 'สินค้าที่จัดส่งตรงตามคำสั่งซื้อทุกประการ แนบรูปตอนแพ็คของก่อนส่งเป็นหลักฐาน',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_SHOP_RESPONSE_LENGTH, MAX_SHOP_RESPONSE_LENGTH)
  response!: string;
}
