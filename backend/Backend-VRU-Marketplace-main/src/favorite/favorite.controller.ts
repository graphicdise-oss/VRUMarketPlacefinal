import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { FavoriteService } from './favorite.service.js';
import { ProductDto } from '../product/dto/product.dto.js';

@ApiTags('favorites')
@Controller('favorites')
export class FavoriteController {
  constructor(private readonly favorites: FavoriteService) {}

  @Get()
  @ApiOperation({ summary: 'List my favorite products' })
  @ApiCookieAuth('access_token')
  async list(@CurrentUser() actor: CurrentUserType): Promise<ProductDto[]> {
    return this.favorites.list(actor.id);
  }

  @Post('products/:productId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Add a product to favorites' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async add(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.favorites.add(actor.id, productId);
  }

  @Delete('products/:productId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a product from favorites' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async remove(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.favorites.remove(actor.id, productId);
  }
}
