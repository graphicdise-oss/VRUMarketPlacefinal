import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CreateShippingCarrierDto } from './create-shipping-carrier.dto.js';

/**
 * Both fields, both required — same convention `UpdateCategoryDto` uses: a partial PATCH is
 * validation machinery nothing here asks for, so editing means sending the whole thing back.
 * `isOther` still cannot be touched through this endpoint, same as create.
 */
export class UpdateShippingCarrierDto extends CreateShippingCarrierDto {
  @ApiProperty({
    description: 'False retires the carrier — see ShippingCarrierDto.isActive for what that means.',
  })
  @IsBoolean()
  isActive!: boolean;
}
