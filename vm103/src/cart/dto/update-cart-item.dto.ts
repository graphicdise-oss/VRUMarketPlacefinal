import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_CART_ITEM_QUANTITY } from '../cart-policy.js';

/** Sets the quantity outright — unlike adding an item, this never adds to what's already there. */
export class UpdateCartItemDto {
  @ApiProperty({ minimum: 1, maximum: MAX_CART_ITEM_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(MAX_CART_ITEM_QUANTITY)
  quantity!: number;
}
