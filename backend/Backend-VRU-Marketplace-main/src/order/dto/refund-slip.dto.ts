import { ApiProperty } from '@nestjs/swagger';

/**
 * One uploaded refund slip, as either the buyer or the shop sees it (#65, K11) — the mirror of
 * `PaymentSlipDto`, minus the reject fields: there is no reject flow here (see `RefundSlip`'s own
 * schema comment). No `fileId` for the same reason that DTO has none — an internal detail of how
 * `GET .../refund-slips/:slipId/file` resolves the bytes, not something a caller needs.
 */
export class RefundSlipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(row: { id: string; orderId: string; createdAt: Date }): RefundSlipDto {
    const dto = new RefundSlipDto();
    dto.id = row.id;
    dto.orderId = row.orderId;
    dto.createdAt = row.createdAt;

    return dto;
  }
}
