import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { CommunityAdminService } from './community-admin.service.js';
import { AssignCommunityAdminDto } from './dto/assign-community-admin.dto.js';
import { CommunityAdminEntryDto } from './dto/community-admin-entry.dto.js';
import { CommunityAdminDto } from './dto/community-admin.dto.js';

/**
 * Who administers a community — `super admin` only, both to grant and to take away.
 *
 * `@RequiresSuperAdmin()` on the class, same reasoning as `AdminUsersController`: this whole
 * resource is a platform-role decision (A2: a community admin may not create a peer), so a
 * per-method decorator here is a route that a later edit could add without it.
 */
@ApiTags('communities')
@ApiCookieAuth('access_token')
@RequiresSuperAdmin()
@Controller('communities/:communityId/admins')
export class CommunityAdminController {
  constructor(private readonly communityAdmins: CommunityAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'Who administers this community',
    description: '§112: super admin only — newest appointment first. A banned admin is listed with `bannedAt`.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiPaginatedResponse(CommunityAdminEntryDto)
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such community.' })
  async list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<CommunityAdminEntryDto>> {
    return this.communityAdmins.list(communityId, query.limit, query.cursor);
  }

  @Post()
  @ApiOperation({
    summary: 'Make a user an admin of this community',
    description:
      'Super admin only (A2) — a community admin cannot appoint a peer. Idempotent for the same ' +
      'pair: assigning someone already an admin here answers 409 rather than writing a second row.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiResponse({ status: 201, type: CommunityAdminDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such community or user, or the account was erased.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already an admin here, the user still has an open shop — admins never run one (§85, N29) — or the user is a super admin (§112).' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async assign(
    @CurrentUser() actor: CurrentUserType,
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: AssignCommunityAdminDto,
  ): Promise<CommunityAdminDto> {
    return this.communityAdmins.assign(actor.id, communityId, dto.userId);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke a user’s admin rights over this community',
    description:
      'Takes effect on the target’s very next request (invariant 7) — nothing that checks admin ' +
      'rights caches the answer, so deleting the row is the whole story.',
  })
  @ApiParam({ name: 'communityId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Revoked.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not an admin of this community.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async revoke(
    @CurrentUser() actor: CurrentUserType,
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.communityAdmins.revoke(actor.id, communityId, userId);
  }
}
