import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminDashboardDto } from './dto/admin-dashboard.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Get unified admin dashboard analytics' })
  @ApiResponse({ status: 200, type: AdminDashboardDto })
  async getDashboard(
    @CurrentUser() user: CurrentUserType,
    @Query('communityId') communityIdFilter?: string,
    @Query('timeFilter') timeFilter: string = 'WEEK',
  ): Promise<AdminDashboardDto> {
    return this.adminDashboardService.getDashboard(user.id, user.role, communityIdFilter, timeFilter);
  }
}
