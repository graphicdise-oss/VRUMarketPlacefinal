import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { PrivacyPolicyResponseDto } from './dto/privacy-policy-response.dto.js';
import { TermsOfServiceResponseDto } from './dto/terms-of-service-response.dto.js';
import { CURRENT_PRIVACY_POLICY_VERSION, CURRENT_TERMS_OF_SERVICE_VERSION } from './policy-version.js';

/**
 * What the frontend needs in order to ask for the acceptances §66 and §90 decided on (#75).
 *
 * The policy and terms *text* is not served from here. Each is a page the frontend owns, linked
 * from the footer; these endpoints answer only "which version is current", so the sign-up form has
 * something to send back and a reason to reload when it is out of date.
 */
@ApiTags('legal')
@Controller('legal')
export class LegalController {
  @Get('privacy-policy')
  // Public because the sign-up form reads it, and nobody has an account at that point. It reveals
  // a date this build ships with — the same date anyone can read on the policy page itself.
  @Public()
  @ApiOperation({
    summary: 'The current privacy policy version',
    description:
      'Read this before showing the sign-up form, and send the value back as ' +
      '`acceptedPrivacyPolicyVersion`. Do not hard-code a version in the frontend: the whole ' +
      'point of the stored acceptance is that it names the wording the person actually saw.',
  })
  @ApiResponse({ status: 200, type: PrivacyPolicyResponseDto })
  current(): PrivacyPolicyResponseDto {
    return { version: CURRENT_PRIVACY_POLICY_VERSION };
  }

  @Get('terms-of-service')
  // Public for the same reason as the policy route: the sign-up form and the Google button read it
  // before anybody has an account.
  @Public()
  @ApiOperation({
    summary: 'The current terms of service version',
    description:
      'Read this alongside the privacy policy version before showing the sign-up form or the ' +
      'Google button, and send it back as `acceptedTermsOfServiceVersion` (register) or ' +
      '`termsVersion` (Google). §90: one checkbox covers both documents.',
  })
  @ApiResponse({ status: 200, type: TermsOfServiceResponseDto })
  currentTerms(): TermsOfServiceResponseDto {
    return { version: CURRENT_TERMS_OF_SERVICE_VERSION };
  }
}
