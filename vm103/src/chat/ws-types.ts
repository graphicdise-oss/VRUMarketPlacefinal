import type { DefaultEventsMap, Socket } from 'socket.io';
import type { ErrorBody } from '../common/errors/error-payload.js';

/**
 * What a live chat connection carries between the handshake and every event on it.
 *
 * `accessToken` is kept (not just the resolved `user`) so that every handler can re-run
 * `SessionService.resolveAccessToken` against the database before doing anything — the same
 * "read the account's current state on every request" invariant 7 already requires of HTTP,
 * applied here to a connection that can sit open far longer than any access token's fifteen
 * minutes. Caching only `user` would mean a ban taking effect only on the *next* `connect`,
 * which is exactly the gap #66's AC calls out by name (send a message on a socket that has
 * been open since before the ban).
 */
export interface ChatSocketData {
  accessToken: string;
  /**
   * §83: the session this connection was opened on — the handshake joins the socket to
   * `sessionRoom(sessionId)` so that ending the session (`SessionRevocations`) can close every
   * socket opened on it, without closing the same person's sockets on other devices. Replaces a
   * `user` field that was written at every event and never read.
   */
  sessionId: string;
  /** §98: the account behind the session, for the access log — set by the handshake with the rest. */
  userId: string;
}

/** The socket.io room every connection on one session sits in (§83). */
export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;

/** §106: every connection of one account — so an admin removed from a community can be taken out of its rooms. */
export const userRoom = (userId: string): string => `user:${userId}`;

/**
 * §106: one admin↔shop room, per side. Two socket.io rooms per conversation because the two sides
 * read different things — the shop never sees which admin wrote, nor what was unsent.
 */
export const shopAdminSocketRoom = (roomId: string, side: 'SHOP' | 'ADMIN'): string => `shop-admin:${roomId}:${side}`;

export type ChatSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, ChatSocketData>;

/** What socket.io hands a handler when the caller passed a callback as the last argument. */
export type AckCallback<T = unknown> = (response: AckResponse<T>) => void;

/**
 * The uniform shape every chat event acknowledges with.
 *
 * A wrapper around L4's own `ErrorBody`, not a second error format: `error` *is*
 * `toErrorPayload(...).body`, the exact object an HTTP failure would carry in its response body.
 * The `{ ok, ... }` envelope itself is unavoidable WS plumbing (an ack has no status line to
 * carry success/failure the way an HTTP response does), never a place a second `code`/`message`
 * shape could grow.
 */
export type AckResponse<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ErrorBody };

/**
 * Every event `ChatGateway` answers, by name. The gateway's `@SubscribeMessage` decorators use
 * these, and the access log (§98) keeps an event's name only if it is one of them — a client can
 * emit any name it likes, and an unknown one is logged as such rather than stored verbatim.
 */
export const CHAT_EVENT = {
  openRoomWithShop: 'openRoomWithShop',
  joinRoom: 'joinRoom',
  sendMessage: 'sendMessage',
  editMessage: 'editMessage',
  unsendMessage: 'unsendMessage',
  listMessageVersions: 'listMessageVersions',
  listMessages: 'listMessages',
  listRooms: 'listRooms',
  // §130: typing, presence, block, report, hide, clear, search
  typing: 'typing',
  stopTyping: 'stopTyping',
  markRoomRead: 'markRoomRead',
  checkOnline: 'checkOnline',
  blockUser: 'blockUser',
  unblockUser: 'unblockUser',
  reportRoom: 'reportRoom',
  hideMessage: 'hideMessage',
  clearRoom: 'clearRoom',
  searchMessages: 'searchMessages',
  // §106: the admin↔shop chat, on the same socket.
  openShopAdminRoom: 'openShopAdminRoom',
  joinShopAdminRoom: 'joinShopAdminRoom',
  sendShopAdminMessage: 'sendShopAdminMessage',
  editShopAdminMessage: 'editShopAdminMessage',
  unsendShopAdminMessage: 'unsendShopAdminMessage',
  listShopAdminMessageVersions: 'listShopAdminMessageVersions',
  listShopAdminMessages: 'listShopAdminMessages',
  listShopAdminRooms: 'listShopAdminRooms',
} as const;
