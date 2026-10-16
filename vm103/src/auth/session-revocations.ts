import { Injectable, Logger } from '@nestjs/common';

type RevocationListener = (sessionIds: readonly string[]) => void;

/**
 * Code review of topic 11 (§83): tells whoever holds a long-lived connection that a session just
 * ended, so the connection ends with it.
 *
 * HTTP never needed this — every request re-reads the session (`AuthGuard`), so a revoked one is
 * refused on the very next call. A chat socket is different: it is authenticated once, at the
 * handshake, and then *receives* broadcasts without making any call at all. Before this, a banned
 * or logged-out user's socket kept hearing every new message in the rooms it had joined, for as
 * long as it stayed open — invariant 7's "แบนแล้วต้องมีผลทันที" held for sending, not for listening.
 *
 * An observer in `AuthModule` rather than `SessionService` calling the chat gateway directly:
 * auth must not depend on chat (chat already depends on auth for `SessionService`), and every
 * way a session ends — logout, ban, password reset, PDPA erasure — already funnels through
 * `SessionService`'s two revoke methods, which are the only callers of `notify`.
 */
@Injectable()
export class SessionRevocations {
  private readonly logger = new Logger(SessionRevocations.name);
  private readonly listeners: RevocationListener[] = [];

  onRevoked(listener: RevocationListener): void {
    this.listeners.push(listener);
  }

  /**
   * Never throws: the revocation itself is already durable by the time this runs, and a listener
   * failing (a socket already gone, say) must not turn a successful logout or ban into an error.
   * Whatever a listener misses is still caught by the per-event re-check on that socket.
   */
  notify(sessionIds: readonly string[]): void {
    if (sessionIds.length === 0) {
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener(sessionIds);
      } catch (error) {
        this.logger.error('A session-revocation listener failed', error instanceof Error ? error.stack : String(error));
      }
    }
  }
}
