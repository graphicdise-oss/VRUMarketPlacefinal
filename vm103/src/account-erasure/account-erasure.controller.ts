import { Controller, Get, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { clearSessionCookies } from '../auth/cookies.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { AppConfig } from '../config/app-config.module.js';
import { AccountErasureService } from './account-erasure.service.js';
import { ErasureStatusDto } from './dto/erasure-status.dto.js';

/**
 * #70/#71: the caller's own PDPA erasure request — nobody else's, ever (see the service's own
 * comment). Not `@Public()`: only a signed-in person can ask to erase the account they are
 * signed in as, and `@CurrentUser()` is what proves which account that is.
 */
@ApiTags('account')
@ApiCookieAuth('access_token')
@Controller('auth/account')
export class AccountErasureController {
  constructor(
    private readonly erasure: AccountErasureService,
    private readonly config: AppConfig,
  ) {}

  @Post('erase')
  @ApiOperation({
    summary: 'Erase my own account under PDPA (G3)',
    description:
      'Erases immediately if nothing is pending. If an order — bought or sold — is still in ' +
      'flight, the request is queued instead of refused (H9): `AccountErasureQueueSweepTask` ' +
      'clears it on its own once every such order either finishes or, for a shipped order, ' +
      'reaches H10’s 15-day cutoff. An open shop still refuses outright (K15) — only the owner ' +
      'can close it. Overwrites PII everywhere it was copied to, never deletes a row, and signs ' +
      'out every device this account is signed into, not just this one.',
  })
  @ApiResponse({ status: 204, description: 'Erased right now. Cookies are cleared.' })
  @ApiResponse({ status: 202, type: ErasureStatusDto, description: 'Queued (H9) — an order is still non-terminal. See `blockers` for why.' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'An open shop (K15), or the account was already erased.',
  })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async erase(@CurrentUser() actor: CurrentUserType, @Res({ passthrough: true }) response: Response): Promise<ErasureStatusDto | undefined> {
    const result = await this.erasure.requestErasure(actor.id);

    if (result.outcome === 'ERASED') {
      response.status(HttpStatus.NO_CONTENT);
      clearSessionCookies(response, this.config.isProduction);

      return undefined;
    }

    // Queued — the account is still fully usable (nothing was erased, no session touched). The
    // caller needs to know why, not be logged out.
    response.status(HttpStatus.ACCEPTED);

    return ErasureStatusDto.queued(result.requestedAt, result.blockers);
  }

  @Get('erasure-status')
  @ApiOperation({
    summary: 'My own PDPA erasure request status (#71, H9)',
    description: 'NONE (never asked), QUEUED (asked, still waiting — see `blockers`), or ERASED.',
  })
  @ApiResponse({ status: 200, type: ErasureStatusDto })
  async status(@CurrentUser() actor: CurrentUserType): Promise<ErasureStatusDto> {
    const result = await this.erasure.getStatus(actor.id);

    return ErasureStatusDto.from(result);
  }
}
