import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

const MIN_LENGTH = 1;
const MAX_LENGTH = 500;

/**
 * §81: a blank reason (`""` or whitespace only) means "no reason given", not a validation error —
 * `@IsOptional()` only skips `null`/`undefined`, so a form that sends `""` for an empty box used to
 * get a 400 for a field the buyer is allowed to leave out. Same fix §80 made for the optional
 * address fields.
 */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * D4: the buyer's own cancel needs no reason (unlike the shop's — see `CancelOrderAsShopDto`) —
 * a reason is accepted and shown to the shop if given, never required.
 */
export class CancelOrderDto {
  @ApiPropertyOptional({ maxLength: MAX_LENGTH, example: 'เปลี่ยนใจ ไม่อยากได้ของแล้ว' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @Length(MIN_LENGTH, MAX_LENGTH)
  reason?: string;
}
