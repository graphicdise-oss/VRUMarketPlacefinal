import { ApiProperty } from '@nestjs/swagger';

/**
 * One uploaded slip, as either the buyer or the shop sees it (#54) — same shape for both, same
 * as `OrderDto` itself. No `fileId`: the id here is an internal detail of how
 * `GET .../payment-slips/:slipId/file` resolves the bytes server-side, not something a caller
 * needs (same reasoning `PaymentChannelDto.hasQrImage` already uses for `qrImageFileId`).
 *
 * `rejectedByUserId` is deliberately not exposed either — the reason (`rejectionReason`) is what
 * a buyer needs to act on; who at the shop clicked the button is not.
 */
export class PaymentSlipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: '#56: set only when the shop rejects this exact slip. Null means not rejected — the row is still on record either way (I3).',
  })
  rejectedAt!: Date | null;

  @ApiProperty({ nullable: true, description: 'The shop’s stated reason — shown to the buyer so they know what to fix.' })
  rejectionReason!: string | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description:
      '§82: set when this slip was never rejected itself but its payment round ended because the ' +
      'shop rejected another slip from the same round. Show it as belonging to an earlier round, ' +
      'not as pending. A slip with both rejectedAt and supersededAt null is one of the current ' +
      'round — the only kind the shop can still reject.',
  })
  supersededAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(row: {
    id: string;
    orderId: string;
    rejectedAt: Date | null;
    rejectionReason: string | null;
    supersededAt: Date | null;
    createdAt: Date;
  }): PaymentSlipDto {
    const dto = new PaymentSlipDto();
    dto.id = row.id;
    dto.orderId = row.orderId;
    dto.rejectedAt = row.rejectedAt;
    dto.rejectionReason = row.rejectionReason;
    dto.supersededAt = row.supersededAt;
    dto.createdAt = row.createdAt;

    return dto;
  }
}
