import { ApiProperty } from '@nestjs/swagger';

/**
 * One uploaded shipping receipt / postal slip as either the buyer or the shop sees it.
 */
export class ShippingSlipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(row: { id: string; orderId: string; createdAt: Date }): ShippingSlipDto {
    const dto = new ShippingSlipDto();
    dto.id = row.id;
    dto.orderId = row.orderId;
    dto.createdAt = row.createdAt;

    return dto;
  }
}
