import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { MAX_VARIANTS_PER_PRODUCT, MIN_VARIANTS_PER_PRODUCT } from '../common/product-policy.js';
import { CreateProductVariantDto } from './create-product-variant.dto.js';
import { ProductDetailsDto } from './product-details.dto.js';

/**
 * #41: adding a product. Images are not part of this body — they go through their own
 * `multipart/form-data` route afterwards (`POST /products/:id/images`), the same two-step shape
 * `PaymentChannel`'s QR photo already uses, rather than one request mixing a JSON body with file
 * parts.
 *
 * `name`/`description`/`categoryId` live on `ProductDetailsDto`, shared with `UpdateProductDto`
 * (#44) — the same three fields, validated the same way, whether creating or editing.
 *
 * No `moderationStatus` field anywhere on this DTO. `whitelist: true` + `forbidNonWhitelisted:
 * true` (the project's global `ValidationPipe`) means a client that tries to send one gets `400`
 * before this class is ever instantiated — the AC's "ร้านแก้ moderationStatus ของตัวเองไม่ได้"
 * holds because there is no field here to carry that value in the first place, not because of a
 * check that could be forgotten.
 */
export class CreateProductDto extends ProductDetailsDto {
  @ApiProperty({
    type: [CreateProductVariantDto],
    minItems: MIN_VARIANTS_PER_PRODUCT,
    maxItems: MAX_VARIANTS_PER_PRODUCT,
    description: `At least ${MIN_VARIANTS_PER_PRODUCT}, at most ${MAX_VARIANTS_PER_PRODUCT} (L7).`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  @ArrayMinSize(MIN_VARIANTS_PER_PRODUCT)
  @ArrayMaxSize(MAX_VARIANTS_PER_PRODUCT)
  variants!: CreateProductVariantDto[];
}
