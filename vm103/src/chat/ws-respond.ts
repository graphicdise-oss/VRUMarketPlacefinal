import { Logger } from '@nestjs/common';
import { toErrorPayload } from '../common/errors/error-payload.js';
import { AckCallback } from './ws-types.js';

const logger = new Logger('ChatGateway');

/**
 * Runs a handler and always calls the ack — success or failure, in the one shape `AckResponse`
 * defines.
 *
 * This exists instead of Nest's usual "return a value to auto-ack, throw to let a filter handle
 * it" pattern because the socket.io adapter's ack machinery (`bindMessageHandlers` in
 * `@nestjs/platform-socket.io`) only calls the client's callback on the *success* path — a
 * thrown error is caught, logged, and the stream completes with nothing sent, which for a caller
 * awaiting an ack looks identical to a server that hung. Every chat handler instead takes the ack
 * callback directly (`@Ack()`, which tells Nest not to auto-ack) and routes through here, so a
 * failure is always a fast, structured answer rather than a client-side timeout.
 *
 * Reuses `toErrorPayload` — the same function `AllExceptionsFilter` calls for HTTP — so a thrown
 * `AppException` produces the exact `{ code, message, fieldErrors }` body an HTTP client would
 * have seen for the same failure (L4: one error format, not a second one for sockets). Only
 * `shouldLog` failures reach the server log, and never with the message content (CLAUDE.md: never
 * log what a user typed).
 */
export async function respond<T>(ack: AckCallback<T>, fn: () => Promise<T>): Promise<void> {
  try {
    const data = await fn();
    ack({ ok: true, data });
  } catch (error) {
    const payload = toErrorPayload(error);
    if (payload.shouldLog) {
      logger.error(`Unhandled chat event failure: ${payload.body.code}`, describeForLog(payload.logAsError));
    }
    ack({ ok: false, error: payload.body });
  }
}

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
