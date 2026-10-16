import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { MAX_PRICE_AMOUNT_MINOR, MAX_VARIANT_NAME_LENGTH, MAX_VARIANT_STOCK, MIN_PRICE_AMOUNT_MINOR } from '../common/product-policy.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * One purchasable option of a product (C1: stock and price live here, never on `Product`).
 * `name` is free text a shop types itself — "สีแดง / ไซส์ M" — and invariant 6 is explicit that
 * editing this specific field later has to send the product back to PENDING review (#44), because
 * it is exactly the field a shop could otherwise use to slip a forbidden item past a reviewer who
 * only read the product's own name.
 */
export class CreateProductVariantDto {
  @ApiProperty({ maxLength: MAX_VARIANT_NAME_LENGTH, example: 'สีแดง / ไซส์ M' })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_VARIANT_NAME_LENGTH)
  name!: string;

  @ApiProperty({ description: 'Satang, integer, never a float (K3).', minimum: MIN_PRICE_AMOUNT_MINOR, maximum: MAX_PRICE_AMOUNT_MINOR })
  @IsInt()
  @Min(MIN_PRICE_AMOUNT_MINOR)
  @Max(MAX_PRICE_AMOUNT_MINOR, { message: `ราคาต่อตัวเลือกต้องไม่เกิน ${(MAX_PRICE_AMOUNT_MINOR / 100).toLocaleString('en-US')} บาท` })
  priceAmountMinor!: number;

  @ApiProperty({ minimum: 0, maximum: MAX_VARIANT_STOCK })
  @IsInt()
  @Min(0)
  @Max(MAX_VARIANT_STOCK, { message: `สต็อกต่อตัวเลือกต้องไม่เกิน ${MAX_VARIANT_STOCK.toLocaleString('en-US')} ชิ้น` })
  stock!: number;
}
