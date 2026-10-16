import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { noteSignedInAccount } from '../access-log/access-log-account.js';
import { AppException } from '../common/errors/app-exception.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { AppConfig } from '../config/app-config.module.js';
import { AuthService } from './auth.service.js';
// `import type`, because a type named in a decorated method's signature is otherwise emitted into
// the decorator metadata as a runtime reference — which TypeScript refuses under isolatedModules.
import type { CurrentUser as CurrentUserType } from './authenticated-request.js';
import {
  clearSessionCookies,
  readSessionCookies,
  setSessionCookies,
} from './cookies.js';
import { csrfBindingFor } from './csrf-binding.js';
import { CSRF_HEADER, CsrfService } from './csrf.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { RateLimited } from './decorators/rate-limit.decorator.js';
import { CsrfTokenDto } from './dto/csrf-token.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { MeDto } from './dto/me.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { RotateOutcome, SessionService } from './session.service.js';

/**
 * The only place in this system that writes an authentication cookie.
 *
 * The controller is the single layer that knows about requests and responses (CLAUDE.md), which
 * here is load-bearing rather than stylistic: it means the rule "a token only ever leaves through
 * a Set-Cookie header" is a property of one file that can be read end to end, instead of a
 * convention that eleven later topics have to remember.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly csrf: CsrfService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  // Two ceilings, because keyed on the address alone this one would not be a ceiling: an attacker
  // registering in bulk simply picks a new address each time. See rate-limit.policy.ts.
  @RateLimited('register', 'registerPerIp')
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Always answers 202 with an empty body, whether or not the address was already ' +
      'registered — the response must not reveal who has an account here (I16). It does not sign ' +
      'you in: from #25 onwards a verification email is sent and you arrive back through it.',
  })
  @ApiResponse({ status: 202, description: 'Accepted. Says nothing about what happened.' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'The form was not valid.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Missing CSRF token.' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description:
      'POLICY_VERSION_OUTDATED — the accepted privacy policy or terms of service version (§90) ' +
      'is no longer current. ' +
      'Reload so the person sees the live wording, then ask again.',
  })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED.' })
  async register(@Body() dto: RegisterDto): Promise<void> {
    await this.auth.register(
      dto.email,
      dto.password,
      dto.acceptedPrivacyPolicyVersion,
      dto.acceptedTermsOfServiceVersion,
    );
  }

  @Public()
  @RateLimited('login', 'loginPerIp')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with an email and password',
    description:
      'Sets the two httpOnly cookies and returns who you are. No token appears in the body (B3). ' +
      'The CSRF token you used to make this call is bound to your previous (anonymous) state, so ' +
      'fetch a new one from GET /auth/csrf before your next write.',
  })
  @ApiResponse({ status: 200, type: MeDto, description: 'Signed in. Cookies are set.' })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'INVALID_CREDENTIALS — identical for an unknown address and a wrong password.',
  })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'ACCOUNT_BANNED, or no CSRF.' })
  @ApiResponse({
    status: 429,
    type: ErrorResponseDto,
    description:
      'RATE_LIMITED. The window reopens on its own — an account is never locked (I17), so this ' +
      'is never a reason to send somebody to support.',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeDto> {
    const { tokens, user } = await this.auth.login(dto.email, dto.password);
    // §98: the sign-in's own access-log row names the account it opened.
    noteSignedInAccount(request, user.id);

    setSessionCookies(response, tokens, this.config.isProduction);

    return MeDto.from(user, await this.auth.adminCommunityIdsOf(user.id));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Exchange the refresh cookie for a new pair',
    description:
      'What the frontend does when a request comes back 401: call this once, then retry the ' +
      'original request. Both tokens are replaced and the 30-day window slides (I17). The CSRF ' +
      'token keeps working, because it is bound to the session rather than to the token. A 204 ' +
      'does not always carry new cookies — see the 204 response below.',
  })
  @ApiResponse({
    status: 204,
    description:
      'Either new cookies are set, or none are: a second request from the same browser racing ' +
      'a refresh that another tab already won gets this same 204 with no Set-Cookie, because it ' +
      'already holds a working pair in the shared cookie jar (DECISIONS.md §72). Retry the ' +
      'original request either way.',
  })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'The refresh token is unknown, spent well past any grace window, expired or revoked. Sign in again.',
  })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { refreshToken } = readSessionCookies(request);

    const outcome: RotateOutcome =
      refreshToken === undefined ? { outcome: 'dead' } : await this.sessions.rotate(refreshToken);

    if (outcome.outcome === 'dead') {
      // The cookies are cleared on the way out. Without this, a browser holding a dead refresh
      // token retries forever: every request 401s, every refresh 401s, and nothing tells the
      // frontend that the state it is in is final.
      clearSessionCookies(response, this.config.isProduction);
      throw new AppException('UNAUTHENTICATED');
    }
    // §98: the refresh's access-log row names the account whose session it extended — it arrives
    // with an expired access token, so nothing else on the request says whose it is.
    noteSignedInAccount(request, outcome.userId);

    if (outcome.outcome === 'raced') {
      // No cookies to set: the request that beat this one to the same rotation already gave the
      // browser a fresh pair, sitting in the cookie jar this request shares. Setting nothing here
      // — rather than the tokens from that other request, which this code never sees — leaves
      // whatever the winner wrote alone. See RotateOutcome and DECISIONS.md §72.
      return;
    }

    setSessionCookies(response, outcome.tokens, this.config.isProduction);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out on the server',
    description:
      'Revokes the session, so the cookies the browser already holds stop working — not merely ' +
      'asks the browser to forget them. Public and idempotent on purpose: the person reaching for ' +
      'this has often left the tab open long enough for the access token to expire, and a sign-out ' +
      'that answers 401 is a sign-out that does not work when it is most needed.',
  })
  @ApiResponse({ status: 204, description: 'Signed out, whether or not there was a session.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeByTokens(readSessionCookies(request));

    clearSessionCookies(response, this.config.isProduction);
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Who am I',
    description:
      'The frontend cannot read the cookies (B3), so this is how it knows whether it is signed ' +
      'in and as whom. Answers from the database, so a ban or a verified address shows up on the ' +
      'next call rather than when the token happens to expire.',
  })
  @ApiResponse({ status: 200, type: MeDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Not signed in.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'ACCOUNT_BANNED.' })
  async me(@CurrentUser() user: CurrentUserType): Promise<MeDto> {
    return MeDto.from(user, await this.auth.adminCommunityIdsOf(user.id));
  }

  @Public()
  @Get('csrf')
  @ApiOperation({
    summary: 'Get a CSRF token',
    description:
      'Call at startup, and again after signing in or out — the token is bound to the session, ' +
      'so a change of identity invalidates the one you were holding. Echo it in the ' +
      `${CSRF_HEADER} header on every request that changes data.`,
  })
  @ApiResponse({ status: 200, type: CsrfTokenDto })
  async csrfToken(@Req() request: Request): Promise<CsrfTokenDto> {
    const binding = await csrfBindingFor(request, this.sessions);

    const dto = new CsrfTokenDto();
    dto.csrfToken = this.csrf.issue(binding);

    return dto;
  }
}
