import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { MAX_EMAIL_LENGTH } from '../auth-policy.js';
import { normaliseEmail } from '../email-address.js';

/**
 * An email field on a DTO: normalised, validated, and described for the generated document.
 *
 * One decorator rather than four lines repeated on every form that takes an address — and there
 * will be several, because #25 (resend verification) and #27 (forgot password) each have one. The
 * risk being removed is not typing: it is that one of those copies normalises and another does
 * not, and then a password reset for `Foo@example.com` silently finds no account.
 *
 * The transform runs before validation (that is the order Nest's ValidationPipe uses), so a
 * trailing space from a phone keyboard's autocomplete does not fail `@IsEmail`.
 */
export function EmailField(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      format: 'email',
      maxLength: MAX_EMAIL_LENGTH,
      description: 'Trimmed and lowercased before anything is done with it.',
      example: 'somchai@example.com',
    }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normaliseEmail(value) : value,
    ),
    MaxLength(MAX_EMAIL_LENGTH),
    // class-validator's default English wording, deliberately not overridden with Thai. The
    // convention topic 1 set is that `message` in the envelope is the Thai sentence to display and
    // `fieldErrors` says which input is at fault — see the cursor error in
    // common/pagination/cursor.ts, which reads the same way. Translating half the fields would
    // leave the frontend unable to tell which values it can show and which it cannot.
    IsEmail(),
  );
}
