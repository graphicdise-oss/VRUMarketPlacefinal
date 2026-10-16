import { IsUUID } from 'class-validator';

/**
 * `joinRoom`: rejoining a room the caller already knows the id of — from `listRooms`, most
 * often, or from a page reload. Membership is re-checked from the database every time this is
 * called (never trusted just because the id was supplied), because a socket.io "reconnect" is a
 * brand new low-level connection that calls this again, and #66's AC is explicit that a
 * reconnect is a new request for entry, not a resumed one.
 */
export class JoinRoomDto {
  @IsUUID()
  roomId!: string;
}
