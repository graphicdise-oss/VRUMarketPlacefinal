import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminDashboardDto } from './dto/admin-dashboard.dto.js';
import { AdminDashboardQueryDto, DashboardRangeQueryDto } from './dto/dashboard-range-query.dto.js';
import { PlatformDashboardDto } from './dto/platform-dashboard.dto.js';

/**
 * §127: the admin dashboards. The community one is scoped by the caller's own rights (the same
 * `communityFilterFor` every admin queue uses), so it needs no guard of its own beyond sign-in; the
 * platform one is super admin only.
 */
@ApiTags('admin')
@ApiCookieAuth('access_token')
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboards: AdminDashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Admin dashboard — queues, community overview and confirmed sales',
    description:
      'Per community the caller administers (every community for a super admin), plus a total. ' +
      'Queue figures are what is waiting now and match the admin lists exactly; orders placed and ' +
      'sales cover the Thai calendar dates from/to (default: the last 30 days).',
  })
  @ApiOkResponse({ type: AdminDashboardDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Bad dates: wrong format, from after to, or more than 366 days.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not an admin of any community, or not of the communityId asked for.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'A super admin asked for a community that does not exist.' })
  async forAdmin(@CurrentUser() actor: CurrentUserType, @Query() query: AdminDashboardQueryDto): Promise<AdminDashboardDto> {
    return this.dashboards.forAdmin(actor, query);
  }

  @Get('platform')
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'Platform dashboard — accounts, communities, admins (super admin only)',
    description: 'Sign-ups count the Thai calendar dates from/to (default: the last 30 days); everything else is as of now.',
  })
  @ApiOkResponse({ type: PlatformDashboardDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Bad dates.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  async forPlatform(@Query() query: DashboardRangeQueryDto): Promise<PlatformDashboardDto> {
    return this.dashboards.forPlatform(query);
  }
}
