import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { FieldErrors } from './app-exception.js';
import { messageFor } from './error-code.js';
import { ErrorBody } from './error-payload.js';

/**
 * Turns class-validator's errors into the project's error body, with `fieldErrors`.
 *
 * Without this, Nest's ValidationPipe produces `{ statusCode, message: string[], error }` — a
 * different shape from every other error in the system, and an array of English sentences the
 * frontend would have to parse to find out which input to highlight. L4 asks for a map from field
 * name to message, which is what a form actually needs.
 *
 * The BadRequestException carries the finished body, and `toErrorPayload` recognises and passes it
 * through untouched. That indirection exists because the pipe has to throw something Nest
 * understands, and the filter is the only thing that writes a response.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const body: ErrorBody = {
    code: 'VALIDATION_FAILED',
    message: messageFor('VALIDATION_FAILED'),
    fieldErrors: collectFieldErrors(errors),
  };

  return new BadRequestException(body);
}

/**
 * Flattens class-validator's tree into `{ 'address.postcode': 'message' }`.
 *
 * Dotted paths rather than a nested object: a frontend looking up the message for the input it is
 * rendering knows that input's path, and walking a nested structure to find it is work for no
 * benefit. Array indices appear as `items.0.quantity`, which is the shape a form library expects.
 *
 * Only the first constraint message per field is kept. Showing a user three reasons their
 * postcode is wrong is not three times as helpful, and class-validator's order puts the most
 * specific first.
 *
 * Exported (not just used locally) so #66's `validateWsBody` can build the identical
 * `fieldErrors` shape for a chat event's payload — the same reasoning that keeps `toErrorPayload`
 * transport-agnostic applies here: two field-error flatteners would drift apart the first time
 * someone fixed a bug in only one.
 */
export function collectFieldErrors(errors: ValidationError[], prefix = ''): FieldErrors {
  const collected: Record<string, string> = {};

  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;

    const messages = Object.values(error.constraints ?? {});
    const first = messages[0];
    if (first !== undefined && collected[path] === undefined) {
      collected[path] = first;
    }

    if (error.children && error.children.length > 0) {
      Object.assign(collected, collectFieldErrors(error.children, path));
    }
  }

  return collected;
}
