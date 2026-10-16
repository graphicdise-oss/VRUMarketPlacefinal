import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { MAX_CART_ITEM_QUANTITY } from '../cart-policy.js';

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid', description: 'A row from GET /products/:id — not a productId.' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_CART_ITEM_QUANTITY, default: 1 })
  @IsInt()
  @Min(1)
  @Max(MAX_CART_ITEM_QUANTITY)
  quantity!: number;
}
