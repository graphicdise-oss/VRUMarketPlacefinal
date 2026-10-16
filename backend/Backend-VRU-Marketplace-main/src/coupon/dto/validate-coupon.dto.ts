import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';
import { CouponDto } from './coupon.dto.js';

export class ValidateCouponRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  shopId!: string;

  @ApiProperty({ description: 'Coupon code or coupon ID' })
  @IsString()
  @IsNotEmpty()
  couponCodeOrId!: string;

  @ApiProperty({ description: 'Current items subtotal in Satang' })
  @IsInt()
  @Min(0)
  subtotalMinor!: number;
}

export class ValidateCouponResponseDto {
  @ApiProperty()
  valid!: boolean;

  @ApiPropertyOptional({ type: CouponDto })
  coupon?: CouponDto;

  @ApiProperty({ description: 'Calculated discount amount in Satang' })
  discountAmountMinor!: number;

  @ApiPropertyOptional({ description: 'Explanation if invalid' })
  reason?: string;
}
