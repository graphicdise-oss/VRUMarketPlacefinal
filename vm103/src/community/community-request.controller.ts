import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { CommunityRequestService } from './community-request.service.js';
import { CommunityRequestDto, CreateCommunityRequestDto, RejectCommunityRequestDto } from './dto/community-request.dto.js';

@ApiTags('community-requests')
@Controller('community-requests')
export class CommunityRequestController {
  constructor(private readonly service: CommunityRequestService) {}

  @Post()
  @ApiOperation({
    summary: 'Request to create a new community',
    description: 'Any logged-in user can request to create a community. Requires Super Admin approval.',
  })
  @ApiResponse({ status: 201, type: CommunityRequestDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Community name already exists.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async create(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreateCommunityRequestDto,
  ): Promise<CommunityRequestDto> {
    return this.service.create(actor.id, dto.name, dto.description, dto.location);
  }

  @Get('pending')
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'List pending community requests',
    description: 'Super admin only.',
  })
  @ApiPaginatedResponse(CommunityRequestDto)
  @ApiCookieAuth('access_token')
  async listPending(
    @Query() query: PaginationQueryDto,
  ): Promise<Page<CommunityRequestDto>> {
    return this.service.listPending(query.limit, query.cursor);
  }

  @Post(':id/approve')
  @RequiresSuperAdmin()
  @ApiOperation({ summary: 'Approve a community request' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, type: CommunityRequestDto })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async approve(
    @CurrentUser() actor: CurrentUserType,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommunityRequestDto> {
    return this.service.approve(id, actor.id);
  }

  @Post(':id/reject')
  @RequiresSuperAdmin()
  @ApiOperation({ summary: 'Reject a community request' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, type: CommunityRequestDto })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async reject(
    @CurrentUser() actor: CurrentUserType,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectCommunityRequestDto,
  ): Promise<CommunityRequestDto> {
    return this.service.reject(id, actor.id, dto.reason);
  }
}
