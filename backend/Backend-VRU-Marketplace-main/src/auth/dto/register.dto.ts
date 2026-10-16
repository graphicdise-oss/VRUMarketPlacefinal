import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsString, Length } from 'class-validator';
import { MAX_POLICY_VERSION_LENGTH } from '../../legal/policy-version.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth-policy.js';
import { EmailField } from './email-field.decorator.js';

export class RegisterDto {
  @EmailField()
  email!: string;

  /**
   * A length rule and nothing else — no "one capital, one digit, one symbol".
   *
   * NIST SP 800-63B advises against composition rules because they produce `Password1!` and a
   * note on the monitor, not stronger passwords. Length is the requirement that survives contact
   * with real people.
   *
   * ⚠️ The minimum is assumed, not decided: see the note on MIN_PASSWORD_LENGTH.
   */
  @ApiProperty({
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
    description:
      'Never logged, never returned, and stored only as an argon2id hash. The maximum is a ' +
      'denial-of-service guard on the hashing cost, not a security rule.',
    example: 'a long enough passphrase',
  })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  password!: string;

  /**
   * The privacy policy version the person was shown and ticked the box for (#75 · §66).
   *
   * A version string rather than a boolean, because a boolean records that somebody clicked
   * something, not what they agreed to. Read the current value from `GET /legal/privacy-policy`
   * and send it straight back; a stale one is refused with POLICY_VERSION_OUTDATED so the page
   * reloads instead of filing an acceptance for wording the person never saw.
   *
   * Required, with no default: a registration that forgets it must fail loudly here rather than
   * quietly create an account with no acceptance behind it.
   */
  @ApiProperty({
    description:
      'The value most recently returned by GET /api/v1/legal/privacy-policy. Never hard-code it.',
    maxLength: MAX_POLICY_VERSION_LENGTH,
    example: '2026-09-30',
  })
  @IsString()
  @Length(1, MAX_POLICY_VERSION_LENGTH)
  acceptedPrivacyPolicyVersion!: string;

  /**
   * The terms of service version the person was shown (§90), sent for the same ticked box.
   *
   * A second field rather than one "accepted" flag even though the form has a single checkbox: the
   * two documents are versioned independently, and the record has to say which wording of each was
   * on the page. Required with no default, for the same reason as the field above.
   */
  @ApiProperty({
    description:
      'The value most recently returned by GET /api/v1/legal/terms-of-service. Never hard-code it.',
    maxLength: MAX_POLICY_VERSION_LENGTH,
    example: '2026-09-29',
  })
  @IsString()
  @Length(1, MAX_POLICY_VERSION_LENGTH)
  acceptedTermsOfServiceVersion!: string;

  /**
   * §98 (owner's decision in §93): the form's second box — "อายุ 20 ปีขึ้นไป หรือผู้ปกครองรับทราบ
   * และยินยอมแล้ว". A minor's contract is voidable without a guardian's consent (ป.พ.พ. ม.21), and
   * buying or opening a shop here is a contract. Only `true` is a confirmation; no date of birth is
   * asked, so there is nothing more to keep than the moment it was ticked.
   */
  @ApiProperty({
    description: 'Must be true: the person ticked "age 20 or over, or a guardian knows and consents" (§98).',
    enum: [true],
    example: true,
  })
  @Equals(true, { message: 'กรุณายืนยันว่าอายุ 20 ปีขึ้นไป หรือผู้ปกครองรับทราบและยินยอมแล้ว' })
  confirmedAgeOrGuardianConsent!: true;
}
