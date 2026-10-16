import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MAX_CARRIER_NAME_LENGTH, MIN_CARRIER_NAME_LENGTH } from '../shipping-carrier-policy.js';

/**
 * `isOther` is deliberately not a field here — see `ShippingCarrierService.create`'s own comment
 * for why a super admin can never create (or rename into) a second catch-all row through this API.
 */
export class CreateShippingCarrierDto {
  @ApiProperty({
    minLength: MIN_CARRIER_NAME_LENGTH,
    maxLength: MAX_CARRIER_NAME_LENGTH,
    example: 'Ninja Van',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_CARRIER_NAME_LENGTH, MAX_CARRIER_NAME_LENGTH)
  name!: string;
}
