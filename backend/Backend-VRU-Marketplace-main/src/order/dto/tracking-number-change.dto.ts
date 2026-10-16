import { ApiProperty } from '@nestjs/swagger';

/**
 * #58 (I15): one edit to `Order.trackingNumber`, oldest first on `OrderDto.trackingNumberHistory`
 * — visible to the buyer as well as the shop (this ticket's own AC: "ผู้ซื้อเห็นประวัตินี้ด้วย"),
 * so a shop cannot quietly swap the number once a dispute is already brewing. `changedBy` is
 * deliberately not exposed — same restraint `PaymentSlipDto.rejectedByUserId` uses — there is only
 * ever one possible "who" (this order's own shop owner).
 */
export class TrackingNumberChangeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  previousTrackingNumber!: string;

  @ApiProperty()
  newTrackingNumber!: string;

  @ApiProperty({ format: 'date-time' })
  changedAt!: Date;

  static from(row: { id: string; previousTrackingNumber: string; newTrackingNumber: string; changedAt: Date }): TrackingNumberChangeDto {
    const dto = new TrackingNumberChangeDto();
    dto.id = row.id;
    dto.previousTrackingNumber = row.previousTrackingNumber;
    dto.newTrackingNumber = row.newTrackingNumber;
    dto.changedAt = row.changedAt;

    return dto;
  }
}
