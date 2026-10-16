import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequiresSuperAdmin } from '../../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../../common/pagination/page.dto.js';
import type { Page } from '../../common/pagination/page.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { RequiresCommunityAdmin } from '../../community/decorators/requires-community-admin.decorator.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { DisputeIdScopeResolver } from '../dispute-id.scope-resolver.js';
import { DisputeAdminDto } from '../dto/dispute-admin.dto.js';
import { DisputeBreakGlassDto } from '../dto/dispute-break-glass.dto.js';
import { DisputeDto } from '../dto/dispute.dto.js';
import { RevealIdentityDto } from '../dto/reveal-identity.dto.js';
import { RuleDisputeDto } from '../dto/rule-dispute.dto.js';
import { DisputeAdminService } from '../services/dispute-admin.service.js';

/**
 * The community-admin (and super-admin-only) side of `Dispute` (#64): ruling, overriding, and
 * the one break-glass door into an order's PII while its dispute is open (I5). Every route here
 * except `override` goes through `@RequiresCommunityAdmin(DisputeIdScopeResolver)` — the same
 * two-layer guard (#32) every other community-admin surface uses.
 */
@ApiTags('disputes')
@ApiCookieAuth('access_token')
@Controller('disputes')
export class DisputeAdminController {
  constructor(private readonly disputesAdmin: DisputeAdminService) {}

  @Get('open')
  @ApiOperation({
    summary: 'List open disputes I may rule on (§102)',
    description:
      'Scoped to the caller like GET /shops/pending: every community for a super admin, the ' +
      'caller’s own communities for a community admin, an empty page for anyone else — and never ' +
      'a dispute the caller is a party to (N28). Newest first. Each item carries `chatRoomId` for ' +
      'the admin chat read. A BUYER_WINS dispute stays here until its refund loop closes it.',
  })
  @ApiPaginatedResponse(DisputeAdminDto)
  async queue(@CurrentUser() actor: CurrentUserType, @Query() query: PaginationQueryDto): Promise<Page<DisputeAdminDto>> {
    return this.disputesAdmin.queue(actor.id, actor.role, query.limit, query.cursor);
  }

  @Get(':disputeId/admin')
  @RequiresCommunityAdmin(DisputeIdScopeResolver)
  @ApiOperation({
    summary: 'One open dispute, as the admin ruling on it sees it (§102)',
    description: 'Same shape as a queue item. Open only (404 once closed, like break-glass) and never by one of its parties (403).',
  })
  @ApiParam({ name: 'disputeId', format: 'uuid' })
  @ApiResponse({ status: 200, type: DisputeAdminDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not this dispute’s shop’s community admin (and not super admin), or a party to it.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such dispute, or it is not currently open.' })
  async adminView(@CurrentUser() actor: CurrentUserType, @Param('disputeId', ParseUUIDPipe) disputeId: string): Promise<DisputeAdminDto> {
    return this.disputesAdmin.adminView(actor.id, disputeId);
  }

  @Post(':disputeId/ruling')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(DisputeIdScopeResolver)
  @ApiOperation({
    summary: 'Rule on an open dispute (K12)',
    description:
      'BUYER_WINS moves the order to REFUND_ORDERED and costs the shop’s owner a disputeLostCount ' +
      '(I12). SHOP_WINS leaves Order.status untouched entirely (I6). Either verdict closes the ' +
      'dispute and releases any freeze on the order (J3). A reason is required — it is shown to ' +
      'both sides, and there is no appeal (I9) so it is the only explanation either gets.',
  })
  @ApiParam({ name: 'disputeId', format: 'uuid' })
  @ApiResponse({ status: 200, type: DisputeDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Missing/too-short reason, or an unknown verdict.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not this dispute’s shop’s community admin, and not super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already ruled — use override (super admin only) instead.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async rule(
    @CurrentUser() actor: CurrentUserType,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: RuleDisputeDto,
  ): Promise<DisputeDto> {
    return this.disputesAdmin.rule(actor.id, disputeId, dto);
  }

  @Post(':disputeId/override')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'Override an already-ruled dispute (I9b) — super admin only',
    description:
      'Not an appeal a party can request (I9) — a super admin’s own, one-sided power. Overwrites ' +
      'the ruling in place and moves disputeLostCount by the one step the corrected verdict implies. ' +
      'To BUYER_WINS: orders the refund like a first ruling (§85) and, if SHOP_WINS had closed the ' +
      'dispute, reopens it for that refund loop (§102). To SHOP_WINS: a refund loop already started ' +
      'keeps running (the money may have moved — invariant 2) but its K11 penalty is waived.',
  })
  @ApiParam({ name: 'disputeId', format: 'uuid' })
  @ApiResponse({ status: 200, type: DisputeDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not super admin — a community admin cannot reverse their own ruling.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not ruled yet — nothing to override.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async override(
    @CurrentUser() actor: CurrentUserType,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: RuleDisputeDto,
  ): Promise<DisputeDto> {
    return this.disputesAdmin.override(actor.id, disputeId, dto);
  }

  @Post(':disputeId/break-glass')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(DisputeIdScopeResolver)
  @ApiOperation({
    summary: 'Reveal this order’s full details while the dispute is open (I5 break-glass)',
    description:
      'The exact same shape the order’s own buyer/shop see — name, address, phone, tracking, ' +
      'plus the slip list. Checked live every call: the instant the dispute closes, this refuses ' +
      '(404) even for the same admin who could see it a second ago. Requires a reason — logged as ' +
      'DISPUTE_IDENTITY_REVEALED, the only record of why this admin looked.',
  })
  @ApiParam({ name: 'disputeId', format: 'uuid' })
  @ApiResponse({ status: 200, type: DisputeBreakGlassDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not this dispute’s shop’s community admin, and not super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such dispute, or it is not currently open.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async breakGlass(
    @CurrentUser() actor: CurrentUserType,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: RevealIdentityDto,
  ): Promise<DisputeBreakGlassDto> {
    return this.disputesAdmin.breakGlass(actor.id, disputeId, dto);
  }

  @Post(':disputeId/break-glass/payment-slips/:slipId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'One payment slip’s raw bytes under break-glass',
    description: 'Same live-open check as break-glass above, its own DISPUTE_IDENTITY_REVEALED entry and reason.',
  })
  @RequiresCommunityAdmin(DisputeIdScopeResolver)
  @ApiParam({ name: 'disputeId', format: 'uuid' })
  @ApiParam({ name: 'slipId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The file bytes, Content-Type set to image/jpeg, image/png, or application/pdf.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such slip, or the dispute is not currently open.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async breakGlassSlipFile(
    @CurrentUser() actor: CurrentUserType,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Param('slipId', ParseUUIDPipe) slipId: string,
    @Body() dto: RevealIdentityDto,
    @Res() response: Response,
  ): Promise<void> {
    sendPrivateFile(response, await this.disputesAdmin.breakGlassSlipFile(actor.id, disputeId, slipId, dto));
  }

  @Get(':disputeId/admin-evidence/:evidenceId')
  @RequiresCommunityAdmin(DisputeIdScopeResolver)
  @ApiOperation({
    summary: 'A piece of dispute evidence, as the community admin judging it',
    description: 'Case evidence, not PII — no reveal reason needed, only the same open-dispute check. Each look is audited as DISPUTE_EVIDENCE_VIEWED (§85).',
  })
  @ApiParam({ name: 'disputeId', format: 'uuid' })
  @ApiParam({ name: 'evidenceId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The file bytes, Content-Type set to image/jpeg or image/png.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such evidence, or the dispute is not currently open.' })
  async adminEvidence(
    @CurrentUser() actor: CurrentUserType,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Res() response: Response,
  ): Promise<void> {
    sendPrivateFile(response, await this.disputesAdmin.readEvidenceAsAdmin(actor.id, disputeId, evidenceId));
  }
}
