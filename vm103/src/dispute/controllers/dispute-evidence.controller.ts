import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { DisputeService } from '../services/dispute.service.js';

/**
 * The evidence file's raw bytes (#63, I17). Not nested under `/orders/:orderId` the way
 * `PaymentSlipController` is — evidence belongs to the dispute, not directly to the order, and a
 * dispute id is enough on its own to resolve which order (and so which party) may read it.
 */
@ApiTags('disputes')
@Controller('disputes')
export class DisputeEvidenceController {
  constructor(private readonly disputes: DisputeService) {}

  @Get(':disputeId/evidence/:evidenceId')
  @ApiOperation({
    summary: 'One piece of evidence’s image bytes',
    description: 'I5: never reachable by a community admin, frozen order or not — break-glass has exactly one door (#64), not this one.',
  })
  @ApiParam({ name: 'disputeId', format: 'uuid' })
  @ApiParam({ name: 'evidenceId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The file bytes, Content-Type set to image/jpeg or image/png.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such dispute, no such evidence, or not a party to it.' })
  @ApiCookieAuth('access_token')
  async readEvidence(
    @CurrentUser() actor: CurrentUserType,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Res() response: Response,
  ): Promise<void> {
    sendPrivateFile(response, await this.disputes.readEvidence(actor.id, disputeId, evidenceId));
  }
}
