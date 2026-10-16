import { ApiProperty } from '@nestjs/swagger';

export class GoogleSignInStatusDto {
  @ApiProperty({
    description:
      '§128: whether this deployment can sign in with Google. When false, hide both Google buttons ' +
      '(sign-in and "connect Google" on the account page) — GET /auth/google would only send the ' +
      'browser back with error=GOOGLE_SIGN_IN_DISABLED.',
    example: true,
  })
  enabled!: boolean;
}
