import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AppException } from './app-exception.js';
import { toErrorPayload } from './error-payload.js';
import { RETRY_AFTER_HEADER } from './retry-after.js';

/**
 * The single place an error becomes an HTTP response.
 *
 * `@Catch()` with no argument catches everything, which is the point: CLAUDE.md rejects
 * per-controller error handling because a controller has a day where it forgets, and the forgotten
 * case is the one that returns Nest's default shape to a frontend expecting ours.
 *
 * The HTTP-specific part is deliberately tiny. Deciding *what* the error is belongs to
 * `toErrorPayload`, which knows nothing about HTTP, so topic 11's websocket filter can reuse it
 * rather than writing a second error format (forbidden by L4).
 *
 * It replies through the HttpAdapter rather than touching Express's `res` directly, so the filter
 * keeps working if the platform ever changes, and so it is still correct for the 404 Nest raises
 * before any route handler ran.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(thrown: unknown, host: ArgumentsHost): void {
    const payload = toErrorPayload(thrown);

    if (payload.shouldLog) {
      // Only the server sees this. The client got `payload.body`, which carries no stack trace,
      // no table name and no Prisma wording.
      this.logger.error(
        `Unhandled ${payload.status}: ${payload.body.code}`,
        describeForLog(payload.logAsError),
      );
    }

    const { httpAdapter } = this.httpAdapterHost;
    const response: unknown = host.switchToHttp().getResponse();
    if (thrown instanceof AppException && thrown.retryAfterSeconds !== undefined) {
      httpAdapter.setHeader(response, RETRY_AFTER_HEADER, String(thrown.retryAfterSeconds));
    }
    httpAdapter.reply(response, payload.body, payload.status);
  }
}

/**
 * A readable description of something that was thrown, for the server log.
 *
 * Not `String(thrown)`: anything that is not an Error stringifies to "[object Object]", which is
 * the least useful thing a log can contain at the exact moment someone needs it. JSON is attempted
 * instead, and a value that cannot even be serialised (a circular structure) reports its type
 * rather than throwing inside the error handler.
 */
function describeForLog(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.stack ?? `${thrown.name}: ${thrown.message}`;
  }

  try {
    return JSON.stringify(thrown) ?? String(typeof thrown);
  } catch {
    return `unserialisable ${typeof thrown}`;
  }
}
