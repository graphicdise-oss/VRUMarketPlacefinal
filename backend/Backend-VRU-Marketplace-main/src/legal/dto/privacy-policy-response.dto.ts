import { ApiProperty } from '@nestjs/swagger';

export class PrivacyPolicyResponseDto {
  @ApiProperty({
    description:
      'The version a registration must accept right now. Send it back as ' +
      '`acceptedPrivacyPolicyVersion` when calling POST /auth/register; a stale value is ' +
      'refused with POLICY_VERSION_OUTDATED rather than silently recorded.',
    example: '2026-09-30',
  })
  version!: string;
}
