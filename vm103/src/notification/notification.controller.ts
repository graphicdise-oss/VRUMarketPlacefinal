import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { MarkAllReadDto } from './dto/mark-all-read.dto.js';
import { NotificationDto } from './dto/notification.dto.js';
import { UnreadCountDto } from './dto/unread-count.dto.js';
import { NotificationService } from './notification.service.js';

/**
 * #69: a user's own notifications — in-app only (the email half, when a type calls for one, is
 * sent by `NotificationService.notify` at the moment the event happens, never read back through
 * here). Every route is scoped to the caller's own `userId` inside the service query itself —
 * there is no route that takes another user's id, and none is planned (I17 fixes the channel;
 * there is no notification-preferences feature to build an admin view of).
 */
@ApiTags('notifications')
@ApiCookieAuth('access_token')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: "The caller's own notifications, newest first" })
  @ApiPaginatedResponse(NotificationDto)
  async list(@CurrentUser() actor: CurrentUserType, @Query() query: PaginationQueryDto): Promise<Page<NotificationDto>> {
    return this.notifications.listForUser(actor.id, query.cursor, query.limit);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many of the caller’s own notifications are unread' })
  @ApiOkResponse({ type: UnreadCountDto })
  async unreadCount(@CurrentUser() actor: CurrentUserType): Promise<UnreadCountDto> {
    return UnreadCountDto.of(await this.notifications.unreadCountFor(actor.id));
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Marks the caller’s own notifications read',
    description: 'Every one, or with upToId only that one and older — a notice that arrived after the list was drawn stays unread (§113).',
  })
  @ApiResponse({ status: 204, description: 'Marked.' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'upToId is not a uuid.' })
  async markAllRead(@CurrentUser() actor: CurrentUserType, @Body() dto: MarkAllReadDto): Promise<void> {
    await this.notifications.markAllRead(actor.id, dto.upToId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marks a single notification as read' })
  @ApiResponse({ status: 204, description: 'Marked.' })
  async markRead(@CurrentUser() actor: CurrentUserType, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(actor.id, id);
  }
}
