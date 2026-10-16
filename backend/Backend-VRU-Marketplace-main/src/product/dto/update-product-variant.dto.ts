import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { CreateProductVariantDto } from './create-product-variant.dto.js';

/**
 * Full replace, same shape as creation — same convention as `UpdatePaymentChannelDto`. Deciding
 * which of invariant 6's two groups an edit falls into is not this DTO's job: `ProductService`
 * compares the incoming `name` against what is already stored (#44's whole point — name shares a
 * row with price/stock but not their group), and only a changed `name` resets the product to
 * PENDING.
 */
export class UpdateProductVariantDto extends CreateProductVariantDto {
  /**
   * §91 (owner's decision): the stock the form showed when it was opened. Confirming a payment
   * cuts stock (#55); a full replace from a form opened before that would put the sold units back
   * on sale. When this no longer matches, the save is refused with STALE_VIEW and nothing changes.
   */
  @ApiProperty({
    minimum: 0,
    description:
      'The `stock` this form displayed when it loaded — not the new value. A mismatch (a payment ' +
      'was confirmed meanwhile) answers 409 STALE_VIEW: reload the variant and save again.',
  })
  @IsInt()
  @Min(0)
  expectedStock!: number;
}
