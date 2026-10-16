import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException, FieldErrors, statusFor } from './app-exception.js';
import { ErrorCode, codeForStatus, messageFor } from './error-code.js';

/**
 * The body of every error this system returns, over any transport (L4).
 *
 * Three fields and no more. No `timestamp` (the client has a clock), no `path` (the client made
 * the request), no `requestId` until something actually correlates logs by one — each of those is
 * a field the frontend has to ignore forever once it exists.
 */
export interface ErrorBody {
  /** Stable English identifier. Branch on this. */
  readonly code: ErrorCode;
  /** Thai, ready to display. Never branch on this. */
  readonly message: string;
  /** Present only when the failure is attributable to named inputs. */
  readonly fieldErrors?: FieldErrors;
}

/** What the HTTP layer needs: the body, plus the status to send it with. */
export interface ErrorPayload {
  readonly status: number;
  readonly body: ErrorBody;
  /**
   * Whether an operator needs to see this. False for ordinary client mistakes — a log full of
   * "someone sent a bad field name" hides the entries that matter.
   *
   * A separate boolean rather than "is `logAsError` defined": code can throw or reject with
   * `undefined`, and that is exactly the case most worth logging. Keying off definedness meant a
   * thrown `undefined` produced a 500 with nothing written down at all.
   */
  readonly shouldLog: boolean;

  /** The thrown value, for the log only. Never serialised into a response. */
  readonly logAsError?: unknown;
}

/**
 * Turns anything that was thrown into the single error format.
 *
 * Deliberately a pure function rather than a method on the HTTP filter. Topic 11 has to emit
 * these same errors over a websocket, and L4 forbids a second format; when that ticket arrives,
 * its gateway filter calls this and uses `body`, ignoring `status`. Putting this logic inside an
 * `ExceptionFilter` would have guaranteed the websocket grew its own copy.
 *
 * The ordering of the checks matters: AppException is ours and most specific, HttpException
 * covers everything the framework raises (including the 404 for an unmatched route and the 400
 * from the validation pipe), Prisma errors are database-shaped and must never reach a client
 * intact, and the final fallback assumes nothing.
 */
export function toErrorPayload(thrown: unknown): ErrorPayload {
  if (thrown instanceof AppException) {
    return {
      status: statusFor(thrown.code),
      body: body(thrown.code, thrown.message, thrown.fieldErrors),
      // A 5xx from our own code is a bug worth reading; a 4xx is the caller being told no.
      shouldLog: statusFor(thrown.code) >= 500,
      logAsError: thrown,
    };
  }

  if (thrown instanceof HttpException) {
    return fromHttpException(thrown);
  }

  if (isPrismaError(thrown)) {
    // Nothing from Prisma reaches the client. Its messages name tables, columns and constraints,
    // and some include the offending values — which for this system means someone's phone number
    // or bank account. The specific database failure goes to the log only.
    return {
      status: 500,
      body: body('INTERNAL_ERROR'),
      shouldLog: true,
      logAsError: thrown,
    };
  }

  return { status: 500, body: body('INTERNAL_ERROR'), shouldLog: true, logAsError: thrown };
}

function fromHttpException(exception: HttpException): ErrorPayload {
  const status = exception.getStatus();
  const response = exception.getResponse();

  // The validation pipe is configured with an exceptionFactory that puts a ready-made ErrorBody
  // here, so field-level detail survives the trip through Nest's exception machinery.
  if (isErrorBody(response)) {
    return { status, body: response, shouldLog: status >= 500, logAsError: exception };
  }

  // Any other framework exception: a 404 for an unmatched route, a 405, a 413 from the body
  // parser. Its own message is framework wording in English ("Cannot GET /nope"), which is
  // neither stable enough to branch on nor something to show a Thai-speaking user, so the code's
  // own message is used instead.
  const code = codeForStatus(status);
  return {
    status,
    body: body(code),
    shouldLog: status >= 500,
    logAsError: exception,
  };
}

function body(code: ErrorCode, message?: string, fieldErrors?: FieldErrors): ErrorBody {
  // fieldErrors is omitted rather than set to {} when empty: an empty object reads as "there are
  // field errors" to code doing a truthiness check.
  return fieldErrors && Object.keys(fieldErrors).length > 0
    ? { code, message: message ?? messageFor(code), fieldErrors }
    : { code, message: message ?? messageFor(code) };
}

function isPrismaError(thrown: unknown): boolean {
  return (
    thrown instanceof Prisma.PrismaClientKnownRequestError ||
    thrown instanceof Prisma.PrismaClientUnknownRequestError ||
    thrown instanceof Prisma.PrismaClientRustPanicError ||
    thrown instanceof Prisma.PrismaClientInitializationError ||
    thrown instanceof Prisma.PrismaClientValidationError
  );
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ErrorBody>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}
