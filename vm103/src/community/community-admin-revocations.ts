import { Injectable, Logger } from '@nestjs/common';

type AdminRevocationListener = (userId: string, communityId: string) => Promise<void> | void;

/**
 * §106: tells whoever holds a long-lived connection that an admin just lost a community — the
 * admin↔shop chat's socket rooms, which an admin joined while they still had the right.
 *
 * The same reasoning as `SessionRevocations` (§83): every HTTP request and every socket event
 * re-reads the admin's standing from the database, but a socket that only *listens* makes no call
 * to be refused on, so without this a removed admin kept hearing every new message from the
 * community's shops. An observer rather than `CommunityAdminService` calling the chat gateway:
 * community rights must not depend on chat.
 */
@Injectable()
export class CommunityAdminRevocations {
  private readonly logger = new Logger(CommunityAdminRevocations.name);
  private readonly listeners: AdminRevocationListener[] = [];

  onRevoked(listener: AdminRevocationListener): void {
    this.listeners.push(listener);
  }

  /**
   * Waits for every listener, so the revoke answers only once the admin's sockets are out of the
   * community's rooms — otherwise a message sent the instant after the 204 could still reach them.
   * Never throws: the revocation is already committed, and whatever a listener misses the per-event
   * re-check still refuses.
   */
  async notify(userId: string, communityId: string): Promise<void> {
    const outcomes = await Promise.allSettled(this.listeners.map(async (listener) => listener(userId, communityId)));
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        const reason: unknown = outcome.reason;
        this.logger.error('A community-admin revocation listener failed', reason instanceof Error ? reason.stack : String(reason));
      }
    }
  }
}
