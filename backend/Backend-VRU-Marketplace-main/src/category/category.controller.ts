import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { CategoryService } from './category.service.js';
import { CategoryDto } from './dto/category.dto.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

/**
 * `Category`: open to read, closed to write (#40) — the same split `CommunityController` uses,
 * and for the same reason: `GET` has to stay `@Public()` (a search page builds its filter list
 * without a session) while `POST`/`PATCH` carry `@RequiresSuperAdmin()` per method rather than a
 * class-level guard.
 *
 * Not a community-admin action: retiring or renaming a category is not one of the six things
 * invariant 1 grants a community admin, so there is no `CommunityScopeGuard` route here at all.
 */
@ApiTags('categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List categories',
    description:
      'No session required (K6/L5) — a search page builds its filter list from this. Retired ' +
      'categories are excluded by default; pass includeInactive=true to see them too.',
  })
  @ApiPaginatedResponse(CategoryDto)
  async list(@Query() query: ListCategoriesQueryDto): Promise<Page<CategoryDto>> {
    return this.categories.list(query.includeInactive, query.limit, query.cursor);
  }

  @Post()
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'Add a category',
    description:
      'Super admin only (C2) — a community admin may not add one. Recorded in audit_log.',
  })
  @ApiResponse({ status: 201, type: CategoryDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Name already in use.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async create(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryDto> {
    return this.categories.create(actor.id, dto.name);
  }

  @Patch(':id')
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'Rename or retire a category',
    description:
      'Super admin only. Both fields are replaced, not merged — send the whole thing back, ' +
      'the same convention PATCH /communities/:id uses. Setting isActive to false retires it ' +
      '(L5): existing products keep it, a shop can no longer choose it. Recorded in audit_log.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CategoryDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such category.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Name already in use.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async update(
    @CurrentUser() actor: CurrentUserType,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    return this.categories.update(actor.id, id, dto.name, dto.isActive);
  }
}
