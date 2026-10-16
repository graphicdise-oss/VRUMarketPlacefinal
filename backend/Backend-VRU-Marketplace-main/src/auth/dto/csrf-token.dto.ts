import { ApiProperty } from '@nestjs/swagger';

/**
 * The CSRF token, which is the one token in this system that travels in a response body.
 *
 * That is not an exception to B3 but the other side of it: B3 puts the **access and refresh**
 * tokens in httpOnly cookies so that no script can read them. This value is meant to be read by
 * the frontend's script and echoed in a header — that is its entire job — and it cannot be
 * delivered any other way, because the frontend is a different origin and therefore cannot read a
 * cookie we set.
 *
 * On its own it grants nothing: it cannot identify anybody, cannot be signed in with, and is
 * useless without the session cookies it is bound to. What stops somebody else's page from
 * obtaining one for your session is the CORS allowlist — see csrf.service.ts, which says what
 * happens if that allowlist is ever loosened.
 */
export class CsrfTokenDto {
  @ApiProperty({
    description:
      'Send as the x-csrf-token header on every POST, PUT, PATCH and DELETE. Bound to the ' +
      'current session, so fetch a new one after signing in or out.',
    example: 'mBtZ5Qn8a-3rK0wQ1Yx2Zc4e.3PW0Fr7w9dK2nQ8yVt1oLmHcZbXsAe6RgUiJkPq4w',
  })
  csrfToken!: string;
}
