import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PaymentChannelType } from '@prisma/client';

/**
 * A shop's own payment channel, as its owner sees it (#36). There is no other view in this
 * ticket — L1's buyer-facing read opens in topic 7, once a real order exists to gate it on, and
 * will almost certainly need its own DTO shape (a buyer has no reason to see `updatedAt`, say).
 *
 * `hasQrImage` rather than the underlying file id: the id is an internal detail of how the QR
 * image is fetched (`GET .../qr-image` resolves it server-side from the channel's own id), not
 * something a caller ever needs to know or could do anything with directly.
 */
export class PaymentChannelDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['BANK_TRANSFER', 'PROMPTPAY'] })
  type!: PaymentChannelType;

  @ApiPropertyOptional({ nullable: true })
  bankName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  bankAccountNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  bankAccountName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  promptPayId!: string | null;

  @ApiProperty()
  hasQrImage!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static from(row: {
    id: string;
    type: PaymentChannelType;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
    promptPayId: string | null;
    qrImageFileId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentChannelDto {
    const dto = new PaymentChannelDto();
    dto.id = row.id;
    dto.type = row.type;
    dto.bankName = row.bankName;
    dto.bankAccountNumber = row.bankAccountNumber;
    dto.bankAccountName = row.bankAccountName;
    dto.promptPayId = row.promptPayId;
    dto.hasQrImage = row.qrImageFileId !== null;
    dto.createdAt = row.createdAt;
    dto.updatedAt = row.updatedAt;

    return dto;
  }
}
