import { Logger } from '@nestjs/common';
import type { ExtendedError } from 'socket.io';
import type { CurrentUser } from '../auth/authenticated-request.js';
import { ACCESS_TOKEN_COOKIE } from '../auth/cookies.js';
import type { SessionService } from '../auth/session.service.js';
import { AppException } from '../common/errors/app-exception.js';
import type { ErrorCode } from '../common/errors/error-code.js';
import { toErrorPayload } from '../common/errors/error-payload.js';
import { sessionRoom, userRoom, type ChatSocket } from './ws-types.js';

/**
 * The namespace middleware every chat connection goes through — invariant 8/9 and B3, applied to
 * a socket instead of a request.
 *
 * Socket.io runs this again for every reconnect, because a client "reconnecting" is a brand new
 * low-level connection from the server's point of view — there is no second code path to keep in
 * sync with this one, which is what makes "reconnect re-checks everything connect does" true for
 * free rather than something that has to be remembered.
 *
 * Reads the cookie the same way HTTP does (`ACCESS_TOKEN_COOKIE`), and reads *only* the cookie:
 * `socket.handshake.auth` and `socket.handshake.query` are never consulted, which is what makes a
 * token offered either way rejected — not by an explicit check, but because nothing here looks.
 *
 * Requires `server.engine.use(cookieParser())` to have already run (see `ChatGateway.afterInit`)
 * so that `socket.request.cookies` exists — engine.io middleware runs ahead of this one, on the
 * same raw handshake request, for both the polling and the websocket transport.
 */
const logger = new Logger('ChatGateway');

export function createChatAuthMiddleware(sessions: SessionService) {
  // socket.io's `.use()` types this as `(socket, next) => void` and never awaits what it
  // returns, so handing it an `async` function directly would leave a rejection nothing catches
  // if `resolveAccessToken` ever threw (a database hiccup, say). This keeps the outer function
  // genuinely synchronous-shaped and routes any such failure back through `next()` itself, the
  // one channel socket.io actually listens on for "this handshake failed".
  return (socket: ChatSocket, next: (err?: ExtendedError) => void): void => {
    authenticate(sessions, socket, next).catch((error: unknown) => {
      logger.error('Chat handshake authentication failed unexpectedly', error instanceof Error ? error.stack : String(error));
      next(handshakeError('INTERNAL_ERROR'));
    });
  };
}

async function authenticate(sessions: SessionService, socket: ChatSocket, next: (err?: ExtendedError) => void): Promise<void> {
  const accessToken = readHandshakeCookie(socket, ACCESS_TOKEN_COOKIE);

  if (accessToken === undefined) {
    next(handshakeError('UNAUTHENTICATED'));
    return;
  }

  const resolved = await sessions.resolveAccessToken(accessToken);

  if (resolved.status === 'banned') {
    next(handshakeError('ACCOUNT_BANNED'));
    return;
  }

  if (resolved.status === 'invalid') {
    next(handshakeError('UNAUTHENTICATED'));
    return;
  }

  socket.data.accessToken = accessToken;
  socket.data.sessionId = resolved.session.sessionId;
  socket.data.userId = resolved.session.user.id;
  // Joined here, before `next()`, so there is no moment in which this socket is connected but
  // not yet reachable by a revocation of its own session (§83).
  await socket.join([sessionRoom(resolved.session.sessionId), userRoom(resolved.session.user.id)]);
  next();
}

function readHandshakeCookie(socket: ChatSocket, name: string): string | undefined {
  // `socket.request` is the raw `http.IncomingMessage` from the handshake. cookie-parser (run as
  // engine-level middleware, not Express middleware — this request never passes through Express)
  // attaches `.cookies` to it the identical way it attaches it to every HTTP request.
  const request = socket.request as unknown as { cookies?: Record<string, unknown> };
  const value = request.cookies?.[name];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function handshakeError(code: ErrorCode): ExtendedError {
  const body = toErrorPayload(new AppException(code)).body;
  const error = new Error(body.code) as ExtendedError;
  error.data = body;

  return error;
}

/**
 * Re-reads the account's current state from the database before every single event — not just
 * at connect — which is invariant 7 applied to a connection that can sit open far longer than
 * an access token's fifteen minutes. #66's AC names this exactly: a user banned mid-conversation
 * must lose the ability to send **on the socket they already hold**, not merely on their next
 * reconnect.
 *
 * Disconnects the socket on the way out for both failure cases. A banned or logged-out account
 * has no further use for a connection that will only ever answer the same error, and closing it
 * outright is what makes "connect again" (and therefore `ws-auth.ts`'s middleware) the one path
 * back in, rather than leaving a socket alive that quietly does nothing forever.
 *
 * `setImmediate`, not an inline `client.disconnect(true)`: throwing here rejects the promise
 * `respond()` is awaiting, and its `ack(...)` call happens in the *microtask* that unwinds from
 * that rejection. `disconnect()` tears down the transport the ack packet still needs to go out
 * on — calling it synchronously, before that microtask has run, was silently dropping the ack
 * (found by this file's own test hanging on its client-side promise rather than ever seeing
 * `ACCOUNT_BANNED`). `setImmediate` runs after every pending microtask drains, which is what
 * guarantees the caller has already been told why before the connection goes away.
 */
export async function requireLiveSocketUser(sessions: SessionService, client: ChatSocket): Promise<CurrentUser> {
  const resolved = await sessions.resolveAccessToken(client.data.accessToken);

  if (resolved.status === 'banned') {
    setImmediate(() => client.disconnect(true));
    throw new AppException('ACCOUNT_BANNED');
  }

  if (resolved.status === 'invalid') {
    setImmediate(() => client.disconnect(true));
    throw new AppException('UNAUTHENTICATED');
  }

  return resolved.session.user;
}
