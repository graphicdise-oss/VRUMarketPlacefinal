import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { RequiresCommunityAdmin } from '../community/decorators/requires-community-admin.decorator.js';
import { sendPrivateFile } from '../files/send-private-file.js';
import { ChatRoomIdScopeResolver } from './chat-room-id.scope-resolver.js';
import { ChatService } from './chat.service.js';
import { ChatMessageVersionDto } from './dto/chat-message-version.dto.js';
import { ChatMessageDto } from './dto/chat-message.dto.js';

/**
 * #68 — I5's break-glass door extended to a chat room: a community admin (or super admin) may
 * read a room's full history and attachments **only** while some order between that room's two
 * parties currently has an open dispute, checked fresh by `ChatRoomIdScopeResolver` on every
 * single request before either route below is even reached — see that resolver's own comment
 * for why it, not this controller or `ChatService`, is where the open-dispute condition lives.
 *
 * Deliberately has no route to send a message: an admin reading under break-glass is not a party
 * to the conversation (invariant 8) — F4/#12's "WebSocket-only" conversation surface is untouched,
 * this is a separate, read-only, plain-HTTP window onto the same rows, the same split #67 already
 * drew for attachments.
 */
@ApiTags('chat')
@ApiCookieAuth('access_token')
@Controller('chat-rooms/:roomId/admin')
export class ChatAdminController {
  constructor(private readonly chat: ChatService) {}

  @Get('messages')
  @RequiresCommunityAdmin(ChatRoomIdScopeResolver)
  @ApiOperation({
    summary: 'A chat room’s full history, while a dispute between its two parties is open (I5/#68)',
    description:
      'The whole room, not only messages sent during the dispute. Refused (403) the instant no ' +
      'order between this room’s buyer and shop owner has a currently open dispute — including ' +
      'right after H7’s cron closes one. Every successful call writes its own DISPUTE_CHAT_VIEWED ' +
      'audit entry, logging only who opened which room and when, never message content. ' +
      'Unlike the parties’ view, a message its sender unsent (§89) keeps its text and picture here.',
  })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiPaginatedResponse(ChatMessageDto)
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'No order between this room’s two parties currently has an open dispute in a community this admin runs, and caller is not super admin.',
  })
  async listMessages(
    @CurrentUser() actor: CurrentUserType,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<ChatMessageDto>> {
    return this.chat.listMessagesAsAdmin(actor.id, roomId, query.cursor, query.limit);
  }

  @Get('messages/:messageId/versions')
  @RequiresCommunityAdmin(ChatRoomIdScopeResolver)
  @ApiOperation({
    summary: 'Every text one message has shown, newest first, under the same open-dispute condition (§89)',
    description:
      'The edit history both parties can also read — plus, for a message its sender unsent, the ' +
      'text the parties can no longer see. Its own DISPUTE_CHAT_VIEWED audit entry.',
  })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiPaginatedResponse(ChatMessageVersionDto)
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No message with this id in this room.' })
  async listMessageVersions(
    @CurrentUser() actor: CurrentUserType,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<ChatMessageVersionDto>> {
    return this.chat.listMessageVersionsAsAdmin(actor.id, roomId, messageId, query.cursor, query.limit);
  }

  @Get('attachments/:fileId')
  @RequiresCommunityAdmin(ChatRoomIdScopeResolver)
  @ApiOperation({
    summary: 'One chat attachment’s bytes, under the same open-dispute condition',
    description: 'Same live check as the message list above; its own DISPUTE_CHAT_VIEWED audit entry.',
  })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'fileId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The file bytes, Content-Type set to image/jpeg or image/png.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'This id is not attached to any message in this room.' })
  async readAttachment(
    @CurrentUser() actor: CurrentUserType,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.chat.readAttachmentAsAdmin(actor.id, roomId, fileId);
    sendPrivateFile(response, file);
  }
}
