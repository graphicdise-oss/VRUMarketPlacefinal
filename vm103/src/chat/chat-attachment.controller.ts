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
import { ChatService } from './chat.service.js';

/**
 * The one part of #67 that is plain HTTP rather than a `ChatGateway` event.
 *
 * A binary upload does not fit a JSON-over-socket.io event without base64 (a third larger, and
 * still needs the same multipart-equivalent validation `FileInterceptor` already gives every
 * other upload in this system) — so, like every other file in this codebase, an attachment goes
 * through its own authenticated HTTP route (K1) and a chat message references the resulting id
 * (`SendMessageDto.fileId`) over the socket, the same "id first, meaningful action second" split
 * `POST /products/:id/images` already uses relative to `POST /products`.
 *
 * Nested under the room, not under a message: uploading happens *before* the message that will
 * reference it exists (`ChatService.sendMessage` is what actually attaches the id), so there is
 * no message id yet to nest under.
 */
@ApiTags('chat')
@Controller('chat-rooms/:roomId/attachments')
export class ChatAttachmentController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AcceptsUpload({ field: 'file', check: (s, userId, p) => s.get(ChatService, { strict: false }).requireAttachmentUploadable(userId, p.roomId!) })
  @ApiOperation({
    summary: 'Upload one image to attach to a chat message',
    description:
      'jpg/png only (K17/E1 — never pdf, on purpose: this is the wall that keeps a payment slip ' +
      'from ever entering a conversation), re-encoded to strip EXIF, up to 10MB · returns only an ' +
      'id — send it as `sendMessage`’s `fileId` over the /chat socket to actually attach it.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiResponse({ status: 201, description: '{ fileId: string }' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not a real jpg/png, or no file sent.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such room, or not one of its two parties.' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'File too large.' })
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

    return this.chat.uploadAttachment(actor.id, roomId, file);
  }

  @Get(':fileId')
  @ApiOperation({
    summary: 'An attachment’s image bytes',
    description: 'Only a party of this room, and only once a message has actually attached this id (see the upload route’s own description).',
  })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'fileId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The file bytes, Content-Type set to image/jpeg or image/png.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such room, not one of its parties, or this id is not attached to any message in it.' })
  @ApiCookieAuth('access_token')
  async readFile(
    @CurrentUser() actor: CurrentUserType,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.chat.readAttachment(actor.id, roomId, fileId);
    sendPrivateFile(response, file);
  }
}
