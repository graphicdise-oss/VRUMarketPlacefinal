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
 * #65 (L9): the buyer's own receiving account for one `REFUND_ORDERED` order. Same discriminated
 * shape as `CreatePaymentChannelDto` — `type` picks which field group is required — reused
 * rather than invented fresh, since it's the same underlying question ("how do I get paid")
 * asked of the other party.
 */
export class RefundAccountDto {
  @ApiProperty({ enum: PaymentChannelType, description: 'Which of the two field groups below applies.' })
  @IsEnum(PaymentChannelType)
  type!: PaymentChannelType;

  @ApiPropertyOptional({ maxLength: MAX_BANK_NAME_LENGTH, description: 'Required when type is BANK_TRANSFER.' })
  @ValidateIf((dto: RefundAccountDto) => dto.type === PaymentChannelType.BANK_TRANSFER)
  @Transform(trim)
  @IsString()
  @Length(1, MAX_BANK_NAME_LENGTH)
  bankName?: string;

  @ApiPropertyOptional({
    maxLength: MAX_BANK_ACCOUNT_NUMBER_LENGTH,
    description: 'Required when type is BANK_TRANSFER.',
  })
  @ValidateIf((dto: RefundAccountDto) => dto.type === PaymentChannelType.BANK_TRANSFER)
  @Transform(trim)
  @IsString()
  @Length(1, MAX_BANK_ACCOUNT_NUMBER_LENGTH)
  bankAccountNumber?: string;

  @ApiPropertyOptional({
    maxLength: MAX_BANK_ACCOUNT_NAME_LENGTH,
    description: 'Required when type is BANK_TRANSFER.',
  })
  @ValidateIf((dto: RefundAccountDto) => dto.type === PaymentChannelType.BANK_TRANSFER)
  @Transform(trim)
  @IsString()
  @Length(1, MAX_BANK_ACCOUNT_NAME_LENGTH)
  bankAccountName?: string;

  @ApiPropertyOptional({
    maxLength: MAX_PROMPTPAY_ID_LENGTH,
    description: 'Required when type is PROMPTPAY — a phone number or citizen id, either one.',
  })
  @ValidateIf((dto: RefundAccountDto) => dto.type === PaymentChannelType.PROMPTPAY)
  @Transform(trim)
  @IsString()
  @Length(1, MAX_PROMPTPAY_ID_LENGTH)
  promptPayId?: string;
}
