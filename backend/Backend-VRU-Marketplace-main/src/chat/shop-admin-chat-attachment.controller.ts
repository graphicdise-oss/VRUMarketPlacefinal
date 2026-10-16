import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Res, UploadedFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AppException } from '../common/errors/app-exception.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { AcceptsUpload } from '../files/accepts-upload.decorator.js';
import { sendPrivateFile } from '../files/send-private-file.js';
import { ShopAdminChatService } from './shop-admin-chat.service.js';

/**
 * §106: the admin↔shop chat's pictures — the same "upload over HTTP, attach by id over the socket"
 * split as the buyer chat's `ChatAttachmentController`, for the same reason (a binary body does not
 * fit a socket.io event). Either side of the room may upload and read; nobody else learns the room
 * exists.
 */
@ApiTags('chat')
@Controller('shop-admin-chat-rooms/:roomId/attachments')
export class ShopAdminChatAttachmentController {
  constructor(private readonly chat: ShopAdminChatService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AcceptsUpload({
    field: 'file',
    check: (s, userId, p) => s.get(ShopAdminChatService, { strict: false }).requireAttachmentUploadableByUserId(userId, p.roomId!),
  })
  @ApiOperation({
    summary: 'Upload one image to attach to an admin↔shop chat message',
    description: 'jpg/png only, re-encoded to strip EXIF, up to 10MB · returns an id to send as `sendShopAdminMessage`’s `fileId` over the /chat socket.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiResponse({ status: 201, description: '{ fileId: string }' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such room, or neither its shop’s owner nor one of its admins.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'The shop is closed, or too many unsent pictures are waiting.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async upload(
    @CurrentUser() actor: CurrentUserType,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ fileId: string }> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.chat.uploadAttachment({ id: actor.id, role: actor.role }, roomId, file);
  }

  @Get(':fileId')
  @ApiOperation({ summary: 'An admin↔shop chat picture’s bytes', description: 'Either side of the room, once a message has attached it. An unsent picture is gone for the shop, not for the admins.' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'fileId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The file bytes.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiCookieAuth('access_token')
  async read(
    @CurrentUser() actor: CurrentUserType,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    sendPrivateFile(response, await this.chat.readAttachment({ id: actor.id, role: actor.role }, roomId, fileId));
  }
}
