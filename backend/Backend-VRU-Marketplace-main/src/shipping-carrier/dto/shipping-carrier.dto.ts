import { ApiProperty } from '@nestjs/swagger';
import type { ShippingCarrier } from '@prisma/client';

/**
 * A courier a shop may pick when it ships an order (#58, L5) — open to read, signed in or not,
 * same reasoning `CategoryDto` gives: a shop building its "ship" form needs this list before the
 * form even opens.
 */
export class ShippingCarrierDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description:
      'K9: true for exactly one row, the catch-all "อื่นๆ" — the only carrier a shop may pair ' +
      'with a free-text Order.carrierNameOther. Never settable through this API.',
  })
  isOther!: boolean;

  @ApiProperty({
    description:
      'False means a shop can no longer choose this for a new shipment — orders that already ' +
      'point at it keep it.',
  })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(carrier: ShippingCarrier): ShippingCarrierDto {
    const dto = new ShippingCarrierDto();
    dto.id = carrier.id;
    dto.name = carrier.name;
    dto.isOther = carrier.isOther;
    dto.isActive = carrier.isActive;
    dto.createdAt = carrier.createdAt;

    return dto;
  }
}
