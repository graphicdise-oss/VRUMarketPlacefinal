import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth-policy.js';

export class ResetPasswordDto {
  /**
   * The `token` query parameter from the link in the email.
   *
   * Posted in a body rather than read from a URL for the same reason VerifyEmailDto is: a token in
   * a URL reaches the browser history, the Referer header of every asset the page loads, and any
   * access log in front of the API. Here it matters more — this one is a temporary password.
   */
  @ApiProperty({
    description: 'The token from the reset link. Single use, valid one hour.',
    maxLength: 512,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  /** The same rule the registration form applies. A reset is not a place to relax it. */
  @ApiProperty({
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
    description: 'Never logged, never returned, and stored only as an argon2id hash.',
    example: 'a long enough passphrase',
  })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  password!: string;
}
