import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_PASSWORD_LENGTH } from '../auth-policy.js';
import { EmailField } from './email-field.decorator.js';

export class LoginDto {
  @EmailField()
  email!: string;

  /**
   * Deliberately **not** checked against the minimum length.
   *
   * Two reasons. A policy that changes later would lock out everyone whose existing password is
   * now too short — they would be told their own correct password is invalid, with no way to reach
   * the reset flow that could fix it. And a minimum enforced here is a free hint about what is
   * worth guessing.
   *
   * The maximum stays, because it is not a policy: it bounds what gets handed to argon2, and
   * without it a megabyte of text would let anyone choose how much memory a login attempt costs.
   */
  @ApiProperty({
    maxLength: MAX_PASSWORD_LENGTH,
    description: 'Never logged and never echoed back, even in an error.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;
}
