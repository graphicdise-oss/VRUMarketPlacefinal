import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { CSRF_HEADER } from './csrf.service.js';
import { Public } from './decorators/public.decorator.js';
import { RateLimited } from './decorators/rate-limit.decorator.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { EmailVerificationService } from './email-verification.service.js';

/**
 * Confirming an email address.
 *
 * Its own controller rather than two more methods on AuthController, and under the same `auth`
 * path so the frontend sees one coherent group. They change for different reasons: signing in is
 * about cookies and sessions, this is about links and a mail provider.
 *
 * Both routes are `@Public()`, and both have to be. Somebody clicking a link from their phone's
 * mail app has no session in that browser, and somebody asking for a new link has an account they
 * cannot yet use.
 */
@ApiTags('auth')
@Controller('auth')
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirm an email address with the token from the link',
    description:
      'Take the token off the URL of the page the link landed on and post it here. It is ' +
      'single-use and valid 24 hours. On success the account is verified — call GET /auth/me to ' +
      'see it, since this endpoint does not sign anybody in (the link is often opened in a ' +
      'different browser from the one that registered).',
  })
  @ApiResponse({ status: 204, description: 'The address is now verified.' })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description:
      'VERIFICATION_LINK_INVALID — unknown, expired or already used. One code for all three: ' +
      'the answer is the same, which is to ask for another link.',
  })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async verify(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.verification.verify(dto.token);
  }

  @Public()
  @RateLimited('verificationLink')
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ask for another verification link',
    description:
      'Always answers 202 with an empty body — for an address that is not registered, for one ' +
      'that is already verified, and when the three-per-hour limit has been reached. The ' +
      'response must not reveal who has an account here (I16), so show the same "check your ' +
      'inbox" message in every case.',
  })
  @ApiResponse({ status: 202, description: 'Accepted. Says nothing about what happened.' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async resend(@Body() dto: ResendVerificationDto): Promise<void> {
    await this.verification.resend(dto.email);
  }
}
