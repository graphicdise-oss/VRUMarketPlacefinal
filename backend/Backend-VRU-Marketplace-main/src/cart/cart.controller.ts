import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequiresVerifiedEmail } from '../auth/decorators/requires-verified-email.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { RefusesAdmins } from '../community/decorators/refuses-admins.decorator.js';
import { CartService } from './cart.service.js';
import { AddCartItemDto } from './dto/add-cart-item.dto.js';
import { CartDto } from './dto/cart.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';

/**
 * `Cart` + `CartItem` (#48, K4). Every route needs a session (there is no cart for a signed-out
 * visitor); only adding an item also needs a verified email, per `@RequiresVerifiedEmail()`'s own
 * doc comment — viewing, changing a quantity, or removing something already in the cart is not
 * "placing an order" and doesn't carry that gate.
 */
@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'View my cart',
    description:
      'Live prices and stock, never frozen (K4). Each item carries `orderable` — false once the ' +
      'product it points at fails invariant 6’s visibility (#42) or its variant was deleted — so ' +
      'a buyer sees why something in their cart can no longer be ordered instead of it vanishing.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiCookieAuth('access_token')
  async getCart(@CurrentUser() actor: CurrentUserType): Promise<CartDto> {
    return this.cart.getCart(actor.id);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @RequiresVerifiedEmail()
  @RefusesAdmins()
  @ApiOperation({
    summary: 'Add an item to my cart',
    description: 'Adding a variant already in the cart increases its quantity rather than duplicating the row.',
  })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Invalid quantity, or the line would pass 999 in total (fieldErrors.quantity).' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Email not verified (K4), the caller is a community admin / super admin — admin accounts never buy (§85, N29) — or it is from the caller’s own shop (§111).' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such variant, or it was deleted.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not orderable right now (under review, shop suspended…), or the cart already holds 100 lines (§111).' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async addItem(@CurrentUser() actor: CurrentUserType, @Body() dto: AddCartItemDto): Promise<CartDto> {
    return this.cart.addItem(actor.id, dto);
  }

  @Patch('items/:cartItemId')
  @ApiOperation({ summary: 'Set a cart item’s quantity outright' })
  @ApiParam({ name: 'cartItemId', format: 'uuid' })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such cart item, or not mine.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async updateQuantity(
    @CurrentUser() actor: CurrentUserType,
    @Param('cartItemId', ParseUUIDPipe) cartItemId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartDto> {
    return this.cart.updateQuantity(actor.id, cartItemId, dto);
  }

  @Delete('items/:cartItemId')
  @ApiOperation({ summary: 'Remove one item from my cart' })
  @ApiParam({ name: 'cartItemId', format: 'uuid' })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such cart item, or not mine.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async removeItem(
    @CurrentUser() actor: CurrentUserType,
    @Param('cartItemId', ParseUUIDPipe) cartItemId: string,
  ): Promise<CartDto> {
    return this.cart.removeItem(actor.id, cartItemId);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty my cart' })
  @ApiResponse({ status: 200, type: CartDto })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async clear(@CurrentUser() actor: CurrentUserType): Promise<CartDto> {
    return this.cart.clear(actor.id);
  }
}
