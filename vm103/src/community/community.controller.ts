import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { CommunityService } from './community.service.js';
import { CommunityDto } from './dto/community.dto.js';
import { CreateCommunityDto } from './dto/create-community.dto.js';
import { ListCommunitiesQueryDto } from './dto/list-communities-query.dto.js';
import { UpdateCommunityDto } from './dto/update-community.dto.js';

/**
 * `Community`: open to read, closed to write.
 *
 * The split is the point of the controller. `GET` is `@Public()` because invariant 1 makes
 * community a filter on reads — no session, no membership, needed to see the list. `POST` and
 * `PATCH` carry `@RequiresSuperAdmin()` instead of a class-level guard, because unlike
 * AdminUsersController this controller has one route that must stay open.
 */
@ApiTags('communities')
@Controller('communities')
export class CommunityController {
  constructor(private readonly communities: CommunityService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List communities',
    description:
      'No session required (invariant 1). The list a frontend turns into a communityId filter ' +
      'for shops and products — not a membership list.',
  })
  @ApiPaginatedResponse(CommunityDto)
  async list(@Query() query: ListCommunitiesQueryDto): Promise<Page<CommunityDto>> {
    return this.communities.list(query.limit, query.cursor);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a community by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CommunityDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<CommunityDto> {
    return this.communities.getById(id);
  }

  @Post()
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'Create a community',
    description: 'Super admin only (A2). Recorded in audit_log.',
  })
  @ApiResponse({ status: 201, type: CommunityDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: '§112: a community with this name already exists (any letter case) — `fieldErrors.name`.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async create(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreateCommunityDto,
  ): Promise<CommunityDto> {
    return this.communities.create(actor.id, dto.name, dto.description);
  }

  @Patch(':id')
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'Edit a community',
    description: 'Super admin only. Both fields are replaced, not merged. Recorded in audit_log.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CommunityDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such community.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: '§112: another community already has this name — `fieldErrors.name`.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async update(
    @CurrentUser() actor: CurrentUserType,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommunityDto,
  ): Promise<CommunityDto> {
    return this.communities.update(actor.id, id, dto.name, dto.description);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'Remove a community created by mistake',
    description: '§112: super admin only, and only while it never had a shop (of any state) and has no admin. Recorded in audit_log.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Removed.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such community.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'It has, or once had, a shop — or it has an admin.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async remove(@CurrentUser() actor: CurrentUserType, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.communities.remove(actor.id, id);
  }
}
