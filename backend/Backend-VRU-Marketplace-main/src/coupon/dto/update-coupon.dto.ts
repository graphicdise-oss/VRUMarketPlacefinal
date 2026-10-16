import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateCouponDto {
  @ApiPropertyOptional({ example: 'ส่วนลดพิเศษ (ขยายเวลา)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ example: 100, description: 'Updated quota (must be >= current claimed count)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quota?: number;

  @ApiPropertyOptional({ example: '2026-11-15T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ example: false, description: 'Enable or disable voucher' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
