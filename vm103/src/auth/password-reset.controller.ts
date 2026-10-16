import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { CSRF_HEADER } from './csrf.service.js';
import { Public } from './decorators/public.decorator.js';
import { RateLimited } from './decorators/rate-limit.decorator.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { PasswordResetService } from './password-reset.service.js';

/**
 * Forgetting a password and setting a new one (I16).
 *
 * Its own controller, under the same `auth` path, for the same reason email verification has one:
 * these two routes change for different reasons from signing in, and keeping them apart means the
 * file that writes session cookies stays small enough to read end to end.
 *
 * Both are `@Public()` and have to be — somebody who cannot sign in is the entire audience.
 */
@ApiTags('auth')
@Controller('auth/password')
export class PasswordResetController {
  constructor(private readonly reset: PasswordResetService) {}

  @Public()
  @RateLimited('resetLink')
  @Post('forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ask for a password-reset link',
    description:
      'Always answers 202 with an empty body — for an address that is not registered, for one ' +
      'that signs in with Google and has no password, for a banned account, and when the ' +
      'three-per-hour limit has been reached. The response must not reveal who has an account ' +
      'here (I16), so show the same "check your inbox" message in every case. An account with no ' +
      'password is told so **in the email**, because only its owner can read that.',
  })
  @ApiResponse({ status: 202, description: 'Accepted. Says nothing about what happened.' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async forgot(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.reset.request(dto.email);
  }

  @Public()
  // Per source rather than per address: this request carries no address. It is here for argon2's
  // cost, not for token guessing — see `passwordReset` in rate-limit.policy.ts.
  @RateLimited('passwordReset')
  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password with the token from the link',
    description:
      'Single use, valid one hour. **On success every session of that account ends** — including ' +
      'the ones on the person\'s own other devices — so the frontend should send them to the ' +
      'sign-in form and say so beforehand. This does not sign anybody in: the link is often ' +
      'opened in a different browser from the one that asked.',
  })
  @ApiResponse({ status: 204, description: 'The password is changed and every session has ended.' })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description:
      'RESET_LINK_INVALID — unknown, expired or already used. One code for all three: the answer ' +
      'is the same, which is to ask for another link.',
  })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'RATE_LIMITED.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.reset.complete(dto.token, dto.password);
  }
}
