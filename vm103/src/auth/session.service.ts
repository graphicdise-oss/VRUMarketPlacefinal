import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import { newId } from '../common/id.js';
import { AppConfig } from '../config/app-config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock, MS_PER_DAY, MS_PER_MINUTE, MS_PER_SECOND } from '../time/clock.js';
import {
  ACCESS_TOKEN_TTL_MINUTES,
  REFRESH_TOKEN_RACE_GRACE_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
} from './auth-policy.js';
import { AuthenticatedSession } from './authenticated-request.js';
import { SessionRevocations } from './session-revocations.js';

/**
 * A freshly minted pair. The raw tokens exist only in this object and in the Set-Cookie header
 * the controller writes from it — never in a log, never in a response body (B3), and never again
 * in the database, which holds only their HMACs.
 */
export interface IssuedTokens {
  readonly sessionId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * What presenting a refresh token to `rotate` produced.
 *
 * Three outcomes rather than a nullable `IssuedTokens`, because two of the failure shapes need
 * different answers from the controller:
 *
 *   - **rotated** — a fresh pair. The ordinary case, and the only one that sets new cookies.
 *   - **raced** — the token was legitimate a moment ago: another request from the same browser
 *     already spent it and got a new pair (REFRESH_TOKEN_RACE_GRACE_SECONDS ago). Nothing is
 *     wrong; the caller already holds a working pair in the same cookie jar, so the answer is
 *     success with no cookies to set, not new tokens and not a refusal.
 *   - **dead** — unknown, expired, revoked, banned, or a token whose grace window (if it ever had
 *     one) has closed. The controller clears the cookies and answers 401.
 */
export type RotateOutcome =
  | { readonly outcome: 'rotated'; readonly tokens: IssuedTokens; readonly userId: string }
  | { readonly outcome: 'raced'; readonly userId: string }
  | { readonly outcome: 'dead' };

/**
 * Sessions: minting, resolving, rotating and revoking them.
 *
 * The tokens are opaque random strings, not JWTs. That is a consequence of two requirements in
 * #24 rather than a preference:
 *
 *   - invariant 7 says a ban must take effect on the next request, so the guard has to read the
 *     account's current state from the database every time;
 *   - logout must make the cookie the browser already holds stop working, not merely ask the
 *     browser to forget it.
 *
 * Once a database read is happening on every request anyway, a self-contained token buys nothing
 * and costs the ability to revoke. A JWT would have left logout as "the cookie keeps working for
 * up to fifteen minutes", which is the AC this ticket states most plainly.
 *
 * What is stored is `HMAC-SHA256(token, secret)`, not the token. A stolen copy of the session
 * table is then not a set of usable cookies: the secret lives in `.env` (ACCESS_TOKEN_SECRET and
 * REFRESH_TOKEN_SECRET, which are deliberately different keys) and not in the database. An HMAC
 * rather than argon2 because these are 256 bits of randomness, not passwords — there is no
 * dictionary to slow down, and a lookup on every request has to be one indexed query.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly revocations: SessionRevocations,
  ) {}

  /**
   * Starts a session for someone who has just proved who they are.
   *
   * `client` lets a caller write the row inside its own transaction — §91's sign-in does, so the
   * session exists only if the password it checked is still the account's password.
   */
  async issue(userId: string, client: Prisma.TransactionClient = this.prisma): Promise<IssuedTokens> {
    const now = this.clock.now();
    const accessToken = newOpaqueToken();
    const refreshToken = newOpaqueToken();
    const sessionId = newId();

    await client.session.create({
      data: {
        id: sessionId,
        userId,
        accessTokenHash: this.hashAccessToken(accessToken),
        accessTokenExpiresAt: this.accessExpiryFrom(now),
        refreshTokenHash: this.hashRefreshToken(refreshToken),
        refreshTokenExpiresAt: this.refreshExpiryFrom(now),
        createdAt: now,
        lastUsedAt: now,
      },
    });

    return { sessionId, accessToken, refreshToken };
  }

  /**
   * Works out who an access token belongs to, and whether they may proceed.
   *
   * Three outcomes, not two, and the third is the reason this is not a nullable return:
   *
   *   - **valid** — a live session; the caller is attached to the request.
   *   - **banned** — the token belongs to an account that is banned. Reported even when the
   *     session has been revoked or has expired, because banning revokes every session, so
   *     collapsing this into "invalid" would mean a banned person's next request looks exactly
   *     like an ordinary timeout. They would be sent to the sign-in form to discover it, two
   *     round trips later, and the frontend's documented reaction to ACCOUNT_BANNED — clear the
   *     session and explain — would almost never fire.
   *   - **invalid** — unknown, expired, or revoked by a logout. Deliberately one outcome: the
   *     client's answer is the same for all three (refresh, then sign in), and a distinction here
   *     would eventually become a distinction in a response.
   */
  async resolveAccessToken(accessToken: string): Promise<AccessTokenResult> {
    const session = await this.prisma.session.findUnique({
      where: { accessTokenHash: this.hashAccessToken(accessToken) },
      select: {
        id: true,
        accessTokenExpiresAt: true,
        revokedAt: true,
        // Selected explicitly rather than including the whole row: a `include: { user: true }`
        // would pull password_hash into memory on every authenticated request, and the safest
        // place for a password hash is nowhere near a request handler.
        user: {
          select: { id: true, email: true, role: true, emailVerifiedAt: true, bannedAt: true, erasedAt: true },
        },
      },
    });

    if (session === null) {
      return { status: 'invalid' };
    }

    // Checked before the session's own validity, so that a ban is what the caller hears about
    // even though banning revoked this row a moment ago.
    if (session.user.bannedAt !== null) {
      return { status: 'banned' };
    }

    // §84: an erased account (PDPA) has no session that works, whether or not revoking its rows
    // ever ran — `AccountErasureService` revokes them after its transaction commits, and a crash
    // in between used to leave every other device signed in to the erased account.
    if (session.revokedAt !== null || session.user.erasedAt !== null) {
      return { status: 'invalid' };
    }

    if (session.accessTokenExpiresAt.getTime() <= this.clock.nowMs()) {
      return { status: 'invalid' };
    }

    return {
      status: 'valid',
      session: {
        sessionId: session.id,
        user: {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role,
          emailVerified: session.user.emailVerifiedAt !== null,
        },
      },
    };
  }

  /**
   * Spends a refresh token and returns a new pair — see RotateOutcome for the three shapes this
   * can come back as.
   *
   * Both tokens are replaced, not just the access token. Rotation means a refresh token that
   * leaks is only useful until its owner next refreshes, at which point it stops working — and
   * the legitimate client, which has the new one, never notices.
   *
   * The 30-day window slides from now (I17), so someone who opens the site every week stays
   * signed in indefinitely and someone who stops for a month has to sign in again.
   *
   * The write is a compare-and-swap on the old hash rather than a plain update: two tabs
   * refreshing at the same moment both read the same row, and without the `where` on the old
   * hash the second would mint a second valid pair from a token that had already been spent.
   * `updateMany` reporting zero rows is how the loser finds out — and used to mean 401, full stop.
   *
   * That was the bug /code-review of #24/#25 found (DECISIONS.md §72): the loser had done nothing
   * wrong. It presented a token that was perfectly live when its own request left the browser; it
   * only looks stale because a sibling tab, sharing the same cookie jar, won the same race a few
   * milliseconds earlier and the browser's cookies now reflect *that* request instead of this one.
   * The old code could not tell that story apart from an actual replay of a long-dead token, and
   * answered both with a 401 that revoked nothing further but left the browser thinking it needed
   * to sign in again — while, in its own cookie jar, a perfectly good session was sitting unused.
   *
   * The fix is `previousRefreshTokenHash`: every winning rotation remembers the hash it rotated
   * away from, for REFRESH_TOKEN_RACE_GRACE_SECONDS. A second request presenting that same
   * just-spent hash within the window is the raced sibling, not an attacker — it is told so
   * without being handed any credentials, because only the winning compare-and-swap ever mints a
   * new pair. Outside the window, the same lookup finds nothing and the answer reverts to `dead`,
   * which is what a genuine replay of a stolen, long-since-rotated token still gets.
   */
  async rotate(refreshToken: string): Promise<RotateOutcome> {
    const presentedHash = this.hashRefreshToken(refreshToken);
    const now = this.clock.now();

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: presentedHash },
      select: {
        id: true,
        userId: true,
        refreshTokenExpiresAt: true,
        revokedAt: true,
        user: { select: { bannedAt: true, erasedAt: true } },
      },
    });

    if (session !== null) {
      // The presented token is (or, a moment ago, was) this session's live refresh token — not a
      // stale one, so the grace-window fallback below has nothing to add here even on failure.
      if (
        session.revokedAt !== null ||
        session.refreshTokenExpiresAt.getTime() <= now.getTime() ||
        // Refusing to mint credentials for a banned account, rather than relying on the ban
        // endpoint having revoked this row. #29 does revoke every session when it bans somebody,
        // and this check is what makes that belt rather than the only strap: topic 10 sets bans
        // as part of freezing orders, and anyone can set the column in SQL during an incident. A
        // path that hands out a new fifteen-minute token to a banned account would undo
        // invariant 7 quietly.
        session.user.bannedAt !== null ||
        // §84: see `resolveAccessToken` — an erased account never gets a fresh pair either.
        session.user.erasedAt !== null
      ) {
        return { outcome: 'dead' };
      }

      const nextAccessToken = newOpaqueToken();
      const nextRefreshToken = newOpaqueToken();

      const { count } = await this.prisma.session.updateMany({
        where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
        data: {
          accessTokenHash: this.hashAccessToken(nextAccessToken),
          accessTokenExpiresAt: this.accessExpiryFrom(now),
          previousRefreshTokenHash: presentedHash,
          previousRefreshTokenExpiresAt: this.raceGraceExpiryFrom(now),
          refreshTokenHash: this.hashRefreshToken(nextRefreshToken),
          refreshTokenExpiresAt: this.refreshExpiryFrom(now),
          lastUsedAt: now,
        },
      });

      if (count > 0) {
        return {
          outcome: 'rotated',
          tokens: {
            sessionId: session.id,
            accessToken: nextAccessToken,
            refreshToken: nextRefreshToken,
          },
          userId: session.userId, // §98: for the refresh's access-log row
        };
      }

      // Lost the compare-and-swap: another request rotated this exact token away between the
      // `findUnique` above and this `updateMany`. Its winning write already stored `presentedHash`
      // as `previousRefreshTokenHash`, so falling through to the grace-window lookup below finds
      // it — same as the branch a request takes when its `findUnique` runs *after* that write.
    }

    const raced = await this.prisma.session.findFirst({
      where: {
        previousRefreshTokenHash: presentedHash,
        previousRefreshTokenExpiresAt: { gt: now },
        revokedAt: null,
      },
      select: { id: true, userId: true },
    });

    return raced === null ? { outcome: 'dead' } : { outcome: 'raced', userId: raced.userId };
  }

  /**
   * §101: the account a live refresh token belongs to, without spending it.
   *
   * Only the Google callback uses this, as the proof of password it needs before connecting a
   * verified account that has one. The person signed in with that password, then pressed "connect
   * Google" and spent longer than the fifteen-minute access token on Google's screens — their
   * browser still holds a refresh token that `rotate` would honour, so it is the same proof.
   *
   * Not rotated here: the callback sets a brand-new session when it succeeds, and a refusal must
   * leave the browser's existing session exactly as it was. Every condition `rotate` refuses on
   * is refused here too — revoked, expired, banned, erased.
   */
  async userIdForRefreshToken(refreshToken: string): Promise<string | null> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: this.hashRefreshToken(refreshToken) },
      select: {
        userId: true,
        refreshTokenExpiresAt: true,
        revokedAt: true,
        user: { select: { bannedAt: true, erasedAt: true } },
      },
    });

    if (
      session === null ||
      session.revokedAt !== null ||
      session.refreshTokenExpiresAt.getTime() <= this.clock.nowMs() ||
      session.user.bannedAt !== null ||
      session.user.erasedAt !== null
    ) {
      return null;
    }

    return session.userId;
  }

  /**
   * The session id behind either cookie, without checking whether it is still alive.
   *
   * Only the CSRF guard uses this, and only to work out which session a CSRF token should be
   * bound to. It accepts an expired or revoked session on purpose: the CSRF check must not be the
   * thing that decides a session is over — that is AuthGuard's job on the access token and
   * `rotate`'s on the refresh token, each of which answers 401 with a clear meaning. A CSRF
   * failure in front of those would send the client to fetch a new CSRF token when what it
   * actually needs is to refresh or to sign in again.
   */
  async findSessionIdForCsrf(tokens: {
    accessToken?: string;
    refreshToken?: string;
  }): Promise<string | null> {
    const conditions = [];

    if (tokens.accessToken !== undefined) {
      conditions.push({ accessTokenHash: this.hashAccessToken(tokens.accessToken) });
    }
    if (tokens.refreshToken !== undefined) {
      conditions.push({ refreshTokenHash: this.hashRefreshToken(tokens.refreshToken) });
    }
    if (conditions.length === 0) {
      return null;
    }

    const session = await this.prisma.session.findFirst({
      where: { OR: conditions },
      select: { id: true },
    });

    return session?.id ?? null;
  }

  /**
   * Ends the session either cookie belongs to. Returns whether there was a live one.
   *
   * Takes the raw cookies rather than a session id so that logout works when the access token has
   * already expired — which is the common case, because the person who reaches for "sign out"
   * has usually left the tab open for a while. Revoking by either hash also means a half-rotated
   * client (new refresh cookie, stale access cookie) still logs out cleanly.
   *
   * The row is marked, not deleted. A replayed cookie then resolves to a revoked session rather
   * than to nothing, which keeps "this session ended" distinguishable from "this token was never
   * real" in the database — and deleting rows on a request path would race the sweep that is
   * already responsible for removing them.
   */
  async revokeByTokens(tokens: { accessToken?: string; refreshToken?: string }): Promise<boolean> {
    const conditions = [];

    if (tokens.accessToken !== undefined) {
      conditions.push({ accessTokenHash: this.hashAccessToken(tokens.accessToken) });
    }
    if (tokens.refreshToken !== undefined) {
      conditions.push({ refreshTokenHash: this.hashRefreshToken(tokens.refreshToken) });
    }
    if (conditions.length === 0) {
      return false;
    }

    // `updateManyAndReturn`, not `updateMany`: §83 needs the ids of exactly the rows this call
    // ended, so a chat socket opened on that session is closed with it (`SessionRevocations`).
    const revoked = await this.prisma.session.updateManyAndReturn({
      where: { OR: conditions, revokedAt: null },
      data: { revokedAt: this.clock.now() },
      select: { id: true },
    });
    this.revocations.notify(revoked.map((session) => session.id));

    return revoked.length > 0;
  }

  /**
   * Signs one person out everywhere. Returns how many sessions ended.
   *
   * I16 requires this of a password reset: someone whose account was taken over resets the
   * password precisely so that whoever is already signed in stops being signed in. #27 calls
   * this; #29 calls it when banning, so that a ban does not wait on the access token's fifteen
   * minutes even for the request already in flight.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const revoked = await this.prisma.session.updateManyAndReturn({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
      select: { id: true },
    });
    // §83: see `revokeByTokens` — a ban, a password reset and an erasure all end here.
    this.revocations.notify(revoked.map((session) => session.id));

    return revoked.length;
  }

  /**
   * Removes sessions whose refresh token has expired. Returns how many went.
   *
   * Called by the sweep (seam 2), never by a request. Once the refresh token is past its date the
   * row cannot authorise anything and cannot be revived — `rotate` refuses it — so it is no
   * longer evidence of anything, just a row that makes the table bigger forever.
   *
   * The cutoff is the row's own expiry rather than "expired for N days", deliberately: a grace
   * period would be a number nobody decided, and there is nothing to be gained by keeping a dead
   * session around for a while.
   */
  async deleteExpired(now: Date): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { refreshTokenExpiresAt: { lt: now } },
    });

    return count;
  }

  private accessExpiryFrom(now: Date): Date {
    // Arithmetic on a timestamp that already came through the clock seam, so this stays
    // testable. Minutes rather than Clock.hoursFromNow because the TTL is expressed in minutes.
     
    return new Date(now.getTime() + ACCESS_TOKEN_TTL_MINUTES * MS_PER_MINUTE);
  }

  private refreshExpiryFrom(now: Date): Date {
     
    return new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY);
  }

  private raceGraceExpiryFrom(now: Date): Date {
     
    return new Date(now.getTime() + REFRESH_TOKEN_RACE_GRACE_SECONDS * MS_PER_SECOND);
  }

  private hashAccessToken(token: string): string {
    return hmacHex(token, this.config.accessTokenSecret);
  }

  private hashRefreshToken(token: string): string {
    return hmacHex(token, this.config.refreshTokenSecret);
  }
}

/**
 * What `resolveAccessToken` found.
 *
 * A discriminated union rather than a nullable session, so that the guard has to say out loud
 * what it does about a banned account — and so that adding a fourth outcome later (a locked
 * account, say) breaks every caller that has not considered it, rather than being silently
 * folded into "invalid".
 */
export type AccessTokenResult =
  | { readonly status: 'valid'; readonly session: AuthenticatedSession }
  | { readonly status: 'banned' }
  | { readonly status: 'invalid' };

/**
 * 256 bits from the system CSPRNG, base64url so it survives a cookie header unencoded.
 *
 * Not a UUID: `newId()` is UUIDv7, whose first 48 bits are a timestamp and whose randomness is
 * 74 bits. That is right for a database key — it sorts chronologically, which cursor pagination
 * depends on — and wrong for a bearer token, where the only property that matters is being
 * unguessable.
 */
function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function hmacHex(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}
