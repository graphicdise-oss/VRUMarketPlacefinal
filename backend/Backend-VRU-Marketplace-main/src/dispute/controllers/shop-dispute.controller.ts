import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UploadedFiles } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { AcceptsUpload } from '../../files/accepts-upload.decorator.js';
import { MAX_EVIDENCE_FILES } from '../common/dispute-policy.js';
import { DisputeDto } from '../dto/dispute.dto.js';
import { RespondDisputeDto } from '../dto/respond-dispute.dto.js';
import { DisputeService } from '../services/dispute.service.js';

/**
 * The shop-owner's own side of `Dispute` (#63) — same `/shops/me/orders` split
 * `ShopOrderController` already uses (no `:shopId` in the path, B2's 1-person-1-shop).
 */
@ApiTags('disputes')
@Controller('shops/me/orders/:orderId/dispute')
export class ShopDisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  @ApiOperation({ summary: 'Every dispute this order has ever had, newest first — my shop’s own read' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: [DisputeDto] })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such order, or not mine.' })
  @ApiCookieAuth('access_token')
  async list(@CurrentUser() actor: CurrentUserType, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<DisputeDto[]> {
    return this.disputes.listForShop(actor.id, orderId);
  }

  @Post('respond')
  @HttpCode(HttpStatus.OK)
  @AcceptsUpload({
    field: 'files',
    maxFiles: MAX_EVIDENCE_FILES,
    check: (s, userId, p) => s.get(DisputeService, { strict: false }).requireRespondable(userId, p.orderId!),
  })
  @ApiOperation({
    summary: 'Respond to the currently open dispute on this order',
    description:
      'J2: a suspended shop may respond exactly as normally as it ships or confirms payment. ' +
      'Set once — a second attempt is refused. Evidence is optional here, unlike opening.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { response: { type: 'string' }, files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: DisputeDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Too many files, or the response is too short.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No open dispute on this order.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already responded.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async respond(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RespondDisputeDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<DisputeDto> {

    return this.disputes.respond(actor.id, orderId, dto, files ?? []);
  }
}
