import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccountErasureService } from '../account-erasure/account-erasure.service.js';
import { ErasureStatusDto } from '../account-erasure/dto/erasure-status.dto.js';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { AdminUsersService } from './admin-users.service.js';
import { BanUserDto } from './dto/ban-user.dto.js';
import { EraseUserDto } from './dto/erase-user.dto.js';
import { FindUserQueryDto } from './dto/find-user-query.dto.js';
import { UserLookupDto } from './dto/user-lookup.dto.js';

/**
 * Super-admin actions on accounts.
 *
 * `@RequiresSuperAdmin()` is on the class, so it covers every route here including ones added
 * later — the failure mode of putting it per method is a new endpoint that nobody remembers to
 * mark, and on this controller that endpoint would be an unprotected ban button.
 */
@ApiTags('admin')
@ApiCookieAuth('access_token')
@RequiresSuperAdmin()
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly erasure: AccountErasureService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Find an account by its exact email',
    description:
      '§112: how a super admin learns the id that ban and appoint take. Exact address only (trimmed, ' +
      'any letter case) — no partial search, so it is not a way to browse accounts.',
  })
  @ApiResponse({ status: 200, type: UserLookupDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'No email, or not an email.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No account holds this address.' })
  async find(@Query() query: FindUserQueryDto): Promise<UserLookupDto> {
    return this.users.findByEmail(query.email);
  }

  @Post(':userId/ban')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Ban an account',
    description:
      'Takes effect on the target’s very next request, not when their token expires (invariant ' +
      '7): every session is revoked and the guard reads the account state from the database on ' +
      'each request. Recorded in audit_log with the reason, which the banned account never sees.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Banned, and signed out everywhere.' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'The reason is missing or too short.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin, or the target is one.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such account.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already banned.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async ban(
    @CurrentUser() actor: CurrentUserType,
    // ParseUUIDPipe so a malformed id is a 400 naming the parameter, rather than reaching Prisma
    // and coming back as an INTERNAL_ERROR that says nothing.
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: BanUserDto,
  ): Promise<void> {
    await this.users.ban(actor.id, userId, dto.reason);
  }

  @Post(':userId/unban')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Lift a ban',
    description:
      'The account can sign in again. The sessions the ban ended are not restored — they were ' +
      'revoked, and a revoked session coming back to life is not something this system should be ' +
      'able to do. §87: an erasure a super admin queued for this account while it was banned ' +
      '(POST /admin/users/{id}/erase) is withdrawn and logged as ACCOUNT_ERASURE_CANCELLED; one the ' +
      'account holder asked for themselves stays queued.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'The ban is lifted.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'The account was not banned.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async unban(
    @CurrentUser() actor: CurrentUserType,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.users.unban(actor.id, userId);
  }

  @Post(':userId/superadmin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Promote an account to Super Admin',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Promoted.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async grantSuperAdmin(
    @CurrentUser() actor: CurrentUserType,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.users.grantSuperAdmin(actor.id, userId);
  }

  @Post(':userId/superadmin/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Demote a Super Admin back to USER',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Demoted.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async revokeSuperAdmin(
    @CurrentUser() actor: CurrentUserType,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.users.revokeSuperAdmin(actor.id, userId);
  }

  @Post(':userId/erase')
  @ApiOperation({
    summary: 'Erase a banned account under PDPA on its own behalf (#74, K16)',
    description:
      'The one door left for a banned account to exercise its PDPA erasure rights: AuthGuard ' +
      'refuses every request a banned account makes, including GET /auth/csrf, so it can never ' +
      'reach POST /auth/account/erase itself (see DECISIONS.md §57/§60). Everything downstream ' +
      'is identical to that self-service endpoint — erases immediately if nothing is pending, ' +
      'queues the request if an order is still non-terminal (H9), refuses if it was already ' +
      'erased — except audit_log records this super admin as the actor, not the target account. ' +
      'Two differences (§86): a reason is required and recorded as ACCOUNT_ERASURE_REQUESTED the ' +
      'moment the request is accepted (also when it only queues), and an open shop is closed on ' +
      'the owner’s behalf when the same I11 rule as closing it yourself allows — otherwise 409 ' +
      'with each blocking order id in fieldErrors, the same shape as POST /shops/:id/close.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Erased right now.' })
  @ApiResponse({ status: 202, type: ErasureStatusDto, description: 'Queued (H9) — an order is still non-terminal. See `blockers` for why.' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'The reason is missing or too short.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such account.' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description:
      'The account is not banned (use self-service instead), was already erased, or owns an open ' +
      'shop that still has orders to settle (fieldErrors keyed by order id).',
  })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async eraseAsAdmin(
    @CurrentUser() actor: CurrentUserType,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: EraseUserDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ErasureStatusDto | undefined> {
    const result = await this.erasure.requestErasureAsAdmin(actor.id, userId, dto.reason);

    if (result.outcome === 'ERASED') {
      response.status(HttpStatus.NO_CONTENT);

      return undefined;
    }

    response.status(HttpStatus.ACCEPTED);

    return ErasureStatusDto.queued(result.requestedAt, result.blockers);
  }
}
