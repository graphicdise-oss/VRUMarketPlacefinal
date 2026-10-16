import proxyaddr from 'proxy-addr';
import type { ExtendedError } from 'socket.io';
import { CHAT_EVENT, type ChatSocket } from '../chat/ws-types.js';
import type { Clock } from '../time/clock.js';
import type { AccessLogService } from './access-log.service.js';

const KNOWN_EVENTS: ReadonlySet<unknown> = new Set(Object.values(CHAT_EVENT));

/**
 * A chat event's name as the log keeps it. The name is whatever the client sent, so only the
 * events `ChatGateway` actually answers are stored by name; anything else is `(unknown)`.
 */
function eventLabel(event: unknown): string {
  return KNOWN_EVENTS.has(event) ? String(event) : '(unknown)';
}

/**
 * §98: the chat side of the access log — one row for the connection and one per event the socket
 * sends, with the account the handshake proved and the caller's address. Never the payload: that
 * is the message itself.
 *
 * Registered after `createChatAuthMiddleware`, so only a connection that passed it gets here and
 * `socket.data.userId` is set. A refused handshake is not logged on this side.
 */
export function createAccessLogSocketMiddleware(accessLog: AccessLogService, clock: Clock, trustedHops: number) {
  return (socket: ChatSocket, next: (err?: ExtendedError) => void): void => {
    // The same library and the same hop rule Express uses for `request.ip` (bootstrap.ts: `trust
    // proxy` = a hop count), so a chat row and an HTTP row from one browser name one address.
    const ipAddress = proxyaddr(socket.request, (_address, hop) => hop < trustedHops);
    const userId = socket.data.userId;
    const record = (action: string): void =>
      accessLog.record({ occurredAt: clock.now(), ipAddress, userId, channel: 'WEBSOCKET', action: `WS /chat ${action}`, statusCode: null });

    record('connect');
    socket.use(([event], proceed) => {
      record(eventLabel(event));
      proceed();
    });
    next();
  };
}
