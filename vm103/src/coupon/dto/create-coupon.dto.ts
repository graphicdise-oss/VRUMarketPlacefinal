import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CouponDiscountType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCouponDto {
  @ApiProperty({ example: 'VRU50', description: 'Unique code for this shop (letters, numbers, dash, underscore)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'โค้ดส่วนลดต้องประกอบด้วยตัวอักษรภาษาอังกฤษ ตัวเลข ขีดกลาง หรือขีดล่างเท่านั้น' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @ApiProperty({ example: 'ส่วนลดพิเศษต้อนรับเปิดเทอม', description: 'Coupon title / description' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({ enum: CouponDiscountType, example: CouponDiscountType.FIXED_AMOUNT })
  @IsEnum(CouponDiscountType)
  discountType!: CouponDiscountType;

  @ApiProperty({
    example: 5000,
    description: 'Discount value: Satang for FIXED_AMOUNT (e.g. 5000 = 50 THB), or 1-100 for PERCENTAGE (e.g. 10 = 10%)',
  })
  @IsInt()
  @Min(1)
  discountValue!: number;

  @ApiPropertyOptional({ example: 20000, description: 'Minimum order spend in Satang (e.g. 20000 = 200 THB)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minSpendAmountMinor?: number;

  @ApiPropertyOptional({
    example: 10000,
    description: 'Maximum discount cap in Satang for PERCENTAGE discount (e.g. 10000 = 100 THB)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiscountAmountMinor?: number;

  @ApiProperty({ example: 50, description: 'Total number of vouchers available to claim' })
  @IsInt()
  @Min(1)
  quota!: number;

  @ApiProperty({ example: '2026-10-14T00:00:00.000Z', description: 'Start validity timestamp (ISO 8601)' })
  @IsISO8601()
  startDate!: string;

  @ApiProperty({ example: '2026-10-31T23:59:59.000Z', description: 'End validity timestamp (ISO 8601)' })
  @IsISO8601()
  endDate!: string;
}
