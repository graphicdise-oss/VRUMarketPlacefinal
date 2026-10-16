import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  /**
   * The `token` query parameter from the link in the email.
   *
   * Sent in a body rather than read from the URL of a GET, which matters more than it looks:
   * a token in a URL reaches the browser history, the Referer header of every asset the page
   * loads, and any access log in front of the API. The frontend takes it off its own URL and
   * posts it, so it never appears in ours.
   *
   * The maximum is generous but present — the value we issue is 43 characters, and an unbounded
   * string is a free way to make the server hash a megabyte.
   */
  @ApiProperty({
    description: 'The token from the verification link. Single use, valid 24 hours.',
    maxLength: 512,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}
