import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { AdminPlatformService } from './admin-platform.service.js';
import { BroadcastNotificationDto } from './dto/admin-platform.dto.js';

@ApiTags('admin')
@Controller('admin')
export class AdminPlatformController {
  constructor(private readonly platformAdmin: AdminPlatformService) {}

  @Post('platform/notifications/broadcast')
  @RequiresSuperAdmin()
  @ApiOperation({ summary: 'Send a broadcast notification to specific user groups' })
  @ApiResponse({ status: 201, description: 'Broadcast sent' })
  async sendBroadcast(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: BroadcastNotificationDto,
  ): Promise<{ success: boolean }> {
    await this.platformAdmin.sendBroadcast(user.id, dto);
    return { success: true };
  }
}
