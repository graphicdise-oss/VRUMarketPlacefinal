import { ApiProperty } from '@nestjs/swagger';

export class TermsOfServiceResponseDto {
  @ApiProperty({
    description:
      'The terms of service version a registration must accept right now. Send it back as ' +
      '`acceptedTermsOfServiceVersion` when calling POST /auth/register, or as `termsVersion` on ' +
      'GET /auth/google; a stale value is refused with POLICY_VERSION_OUTDATED rather than ' +
      'silently recorded.',
    example: '2026-09-29',
  })
  version!: string;
}
