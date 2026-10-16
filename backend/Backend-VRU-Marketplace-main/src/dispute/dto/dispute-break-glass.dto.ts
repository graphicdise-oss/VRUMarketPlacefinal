import { ApiProperty } from '@nestjs/swagger';
import { OrderDto } from '../../order/dto/order.dto.js';
import { PaymentSlipDto } from '../../order/dto/payment-slip.dto.js';

/**
 * #64: the one door into an order's PII while a dispute on it is open (I5's break-glass) — the
 * exact same shape the order's own buyer or shop sees (`OrderDto`, full address/phone/tracking),
 * plus the slip list a community admin has no other route to at all (#54's own `readFile` is
 * party-only by design). The slip *files* themselves are a separate call
 * (`POST .../payment-slips/:slipId`) — each one logs its own `DISPUTE_IDENTITY_REVEALED` entry.
 */
export class DisputeBreakGlassDto {
  @ApiProperty({ type: OrderDto })
  order!: OrderDto;

  @ApiProperty({ type: [PaymentSlipDto] })
  paymentSlips!: PaymentSlipDto[];

  static from(order: OrderDto, paymentSlips: PaymentSlipDto[]): DisputeBreakGlassDto {
    const dto = new DisputeBreakGlassDto();
    dto.order = order;
    dto.paymentSlips = paymentSlips;

    return dto;
  }
}
