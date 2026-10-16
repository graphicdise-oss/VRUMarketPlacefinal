import type { NextFunction, Request, Response } from 'express';
import { readSession } from '../auth/authenticated-request.js';
import type { Clock } from '../time/clock.js';
import { readSignedInAccount } from './access-log-account.js';
import type { AccessLogService } from './access-log.service.js';

/**
 * §98: one access-log row per HTTP request, written once the response has finished.
 *
 * The action is the method and the route's *pattern* — `req.route.path`, which Express fills in
 * only for a matched route — never `req.originalUrl`: a concrete path carries ids, and a query
 * string can carry a search term or a token. An unmatched request (a 404) is logged by method
 * alone, so a scanner's made-up paths are not stored either.
 *
 * The account is read at the end, after `AuthGuard` has attached the session (or the sign-in has
 * noted the account it just opened).
 */
export function accessLogMiddleware(accessLog: AccessLogService, clock: Clock) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const occurredAt = clock.now();
    response.on('finish', () => {
      const route = (request.route as { path?: unknown } | undefined)?.path;
      const pattern = typeof route === 'string' ? `${request.baseUrl}${route}` : '(unmatched)';
      accessLog.record({
        occurredAt,
        ipAddress: request.ip ?? request.socket.remoteAddress ?? 'unknown',
        userId: readSession(request)?.user.id ?? readSignedInAccount(request),
        channel: 'HTTP',
        action: `${request.method} ${pattern}`,
        statusCode: response.statusCode,
      });
    });
    next();
  };
}
