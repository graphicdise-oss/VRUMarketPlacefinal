import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';
import { MAX_PRODUCT_DESCRIPTION_LENGTH, MAX_PRODUCT_NAME_LENGTH } from '../common/product-policy.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * The three product-level fields invariant 6 puts in the "edit resets to PENDING" group — name,
 * description, category (#44). Variant-level fields are a separate story with their own group
 * split — see `UpdateProductVariantDto`.
 *
 * Shared base for `CreateProductDto` (#41) and `UpdateProductDto` (#44) so the two validation
 * rules never drift apart — the same reasoning that keeps variant field validation in
 * `CreateProductVariantDto` alone rather than copied into a second class.
 */
export class ProductDetailsDto {
  @ApiProperty({ maxLength: MAX_PRODUCT_NAME_LENGTH })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_PRODUCT_NAME_LENGTH)
  name!: string;

  @ApiProperty({ maxLength: MAX_PRODUCT_DESCRIPTION_LENGTH })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_PRODUCT_DESCRIPTION_LENGTH)
  description!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'A row from GET /categories (#40). Must be isActive — a retired category cannot be chosen.',
  })
  @IsUUID()
  categoryId!: string;
}
