import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFiles } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { AcceptsUpload } from '../../files/accepts-upload.decorator.js';
import { MAX_EVIDENCE_FILES } from '../common/dispute-policy.js';
import { DisputeDto } from '../dto/dispute.dto.js';
import { OpenDisputeDto } from '../dto/open-dispute.dto.js';
import { DisputeService } from '../services/dispute.service.js';

/**
 * The buyer's own side of `Dispute` (#63) — nested under the order it's about, same reasoning
 * `OrderReviewController` already uses. `DisputeService` scopes every query to `{ orderId,
 * buyerId }`, never `orderId` alone, so this controller never has to check ownership itself.
 */
@ApiTags('disputes')
@Controller('orders/:orderId/dispute')
export class OrderDisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Post()
  @AcceptsUpload({
    field: 'files',
    maxFiles: MAX_EVIDENCE_FILES,
    check: (s, userId, p) => s.get(DisputeService, { strict: false }).requireOpenable(userId, p.orderId!),
  })
  @ApiOperation({
    summary: 'Open a dispute on this order',
    description:
      'Only from the moment a payment slip exists (H5), and only within D5b’s window (15 days ' +
      'from shipping or 7 from being marked received, whichever is first — paused while frozen). ' +
      'Evidence is mandatory: at least one jpg/png file, up to 10. Order.status is never touched ' +
      '(I6) — only this Dispute row is created.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { reason: { type: 'string' }, files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 201, type: DisputeDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'No evidence attached, too many files, or the reason is too short.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'No slip uploaded yet, past D5b’s window, or one is already open.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async open(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: OpenDisputeDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<DisputeDto> {

    return this.disputes.open(actor.id, orderId, dto, files ?? []);
  }

  @Get()
  @ApiOperation({ summary: 'Every dispute this order has ever had, newest first', description: 'K13: reopening after one closes is allowed.' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: [DisputeDto] })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiCookieAuth('access_token')
  async list(@CurrentUser() actor: CurrentUserType, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<DisputeDto[]> {
    return this.disputes.listForBuyer(actor.id, orderId);
  }
}
