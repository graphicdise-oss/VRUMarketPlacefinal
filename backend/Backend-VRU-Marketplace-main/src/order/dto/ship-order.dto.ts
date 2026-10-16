import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

const MIN_TRACKING_NUMBER_LENGTH = 1;
const MAX_TRACKING_NUMBER_LENGTH = 100;
const MIN_CARRIER_NAME_OTHER_LENGTH = 1;
const MAX_CARRIER_NAME_OTHER_LENGTH = 100;

/**
 * #58 (F1/K9): a shop picks a real `ShippingCarrier` row, never types a name — except
 * `carrierNameOther`, which only makes sense alongside the one "อื่นๆ" row and is rejected
 * otherwise (`ShippingService.ship` checks this against the row it looked up, not here — this DTO
 * cannot know which row `shippingCarrierId` names). `trackingNumber` is mandatory in every case,
 * "อื่นๆ" included (K9: "เลขพัสดุบังคับกรอกทุกกรณี").
 */
export class ShipOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  shippingCarrierId!: string;

  @ApiPropertyOptional({
    minLength: MIN_CARRIER_NAME_OTHER_LENGTH,
    maxLength: MAX_CARRIER_NAME_OTHER_LENGTH,
    description: 'Required if, and only if, shippingCarrierId names the "อื่นๆ" carrier (K9).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_CARRIER_NAME_OTHER_LENGTH, MAX_CARRIER_NAME_OTHER_LENGTH)
  carrierNameOther?: string;

  @ApiProperty({ minLength: MIN_TRACKING_NUMBER_LENGTH, maxLength: MAX_TRACKING_NUMBER_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_TRACKING_NUMBER_LENGTH, MAX_TRACKING_NUMBER_LENGTH)
  trackingNumber!: string;
}
