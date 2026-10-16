import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const MIN_TRACKING_NUMBER_LENGTH = 1;
const MAX_TRACKING_NUMBER_LENGTH = 100;

/** #58 (I15): corrects a tracking number typed in wrong — see `ShippingService.updateTrackingNumber`. */
export class UpdateTrackingNumberDto {
  @ApiProperty({ minLength: MIN_TRACKING_NUMBER_LENGTH, maxLength: MAX_TRACKING_NUMBER_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_TRACKING_NUMBER_LENGTH, MAX_TRACKING_NUMBER_LENGTH)
  trackingNumber!: string;
}
