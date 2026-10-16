import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentChannelType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length, ValidateIf } from 'class-validator';

const MAX_BANK_NAME_LENGTH = 100;
const MAX_BANK_ACCOUNT_NUMBER_LENGTH = 50;
const MAX_BANK_ACCOUNT_NAME_LENGTH = 100;
const MAX_PROMPTPAY_ID_LENGTH = 50;

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * #36 (K5): a shop's own words for one way to pay it. The system never validates a bank name
 * against a real list, never checks a PromptPay id's format, and never generates a QR from any
 * of this — a shop that types nonsense here is a shop nobody will successfully pay, which is a
 * problem between the shop and its buyers, not one this API is in a position to catch.
 *
 * `type` decides which of the two field groups is required — validated with `@ValidateIf` rather
 * than two separate DTOs (`CreateBankChannelDto` / `CreatePromptPayChannelDto`), because a single
 * discriminated shape is what the corresponding `PATCH` (full replace, `UpdatePaymentChannelDto`
 * extends this) and the database row already are.
 */
export class CreatePaymentChannelDto {
  @ApiProperty({ enum: PaymentChannelType, description: 'Which of the two field groups below applies.' })
  @IsEnum(PaymentChannelType)
  type!: PaymentChannelType;

  @ApiPropertyOptional({ maxLength: MAX_BANK_NAME_LENGTH, description: 'Required when type is BANK_TRANSFER.' })
  @ValidateIf((dto: CreatePaymentChannelDto) => dto.type === PaymentChannelType.BANK_TRANSFER)
  @Transform(trim)
  @IsString()
  @Length(1, MAX_BANK_NAME_LENGTH)
  bankName?: string;

  @ApiPropertyOptional({
    maxLength: MAX_BANK_ACCOUNT_NUMBER_LENGTH,
    description: 'Required when type is BANK_TRANSFER.',
  })
  @ValidateIf((dto: CreatePaymentChannelDto) => dto.type === PaymentChannelType.BANK_TRANSFER)
  @Transform(trim)
  @IsString()
  @Length(1, MAX_BANK_ACCOUNT_NUMBER_LENGTH)
  bankAccountNumber?: string;

  @ApiPropertyOptional({
    maxLength: MAX_BANK_ACCOUNT_NAME_LENGTH,
    description: 'Required when type is BANK_TRANSFER.',
  })
  @ValidateIf((dto: CreatePaymentChannelDto) => dto.type === PaymentChannelType.BANK_TRANSFER)
  @Transform(trim)
  @IsString()
  @Length(1, MAX_BANK_ACCOUNT_NAME_LENGTH)
  bankAccountName?: string;

  @ApiPropertyOptional({
    maxLength: MAX_PROMPTPAY_ID_LENGTH,
    description: 'Required when type is PROMPTPAY — a phone number or citizen id, either one.',
  })
  @ValidateIf((dto: CreatePaymentChannelDto) => dto.type === PaymentChannelType.PROMPTPAY)
  @Transform(trim)
  @IsString()
  @Length(1, MAX_PROMPTPAY_ID_LENGTH)
  promptPayId?: string;
}
