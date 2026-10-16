import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { newId } from '../common/id.js';
import { AppConfig } from '../config/app-config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock, MS_PER_HOUR } from '../time/clock.js';

/**
 * What a single-use link is for. A String column with this union over it — see the model comment
 * in schema.prisma for why that rather than a database enum.
 *
 * `PASSWORD_RESET` arrived with #27 and needed no migration to do so, which is the whole point of
 * the choice: a value was added to a closed set by editing one line.
 */
export const VERIFICATION_PURPOSES = ['EMAIL_VERIFICATION', 'PASSWORD_RESET'] as const;

export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

/** Why a presented link did not work. The caller decides what, if anything, to say about it. */
export type ConsumeFailure = 'UNKNOWN' | 'EXPIRED' | 'ALREADY_USED';

export type ConsumeResult =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: ConsumeFailure };

/**
 * Issuing and spending the single-use links this system sends by email.
 *
 * Everything about a link that is not specific to *why* it was sent lives here: the secret, its
 * hash, its expiry, spending it exactly once, and the count behind the per-hour limit. The caller
 * supplies the purpose and the lifetime, and decides what consuming one means.
 *
 * Like a session token, what reaches the database is an HMAC rather than the value in the email —
 * a link in an inbox is a temporary password for that account, so a copy of this table must not be
 * a set of working links.
 */
@Injectable()
export class VerificationTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  /**
   * Mints a link secret and records it. The raw value is returned once and never stored.
   *
   * @param lifetimeHours 24 for verification (B0.1), 1 for a password reset (I16). Passed in
   *   rather than looked up here, because the number belongs to the flow that owns it and both
   *   are written down in auth-policy.ts.
   */
  async issue(
    userId: string,
    purpose: VerificationPurpose,
    lifetimeHours: number,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');

    await this.prisma.verificationToken.create({
      data: {
        id: newId(),
        userId,
        purpose,
        tokenHash: this.hash(token),
        expiresAt: this.clock.hoursFromNow(lifetimeHours),
        createdAt: this.clock.now(),
      },
    });

    return token;
  }

  /**
   * Spends a link, or says why it could not be spent.
   *
   * The write is a conditional update on `usedAt` still being null, so two clicks that arrive at
   * the same moment cannot both succeed — the loser is told the link was already used, which is
   * what actually happened. Checking and then updating would let both through, and for #27 that
   * means two password resets from one link.
   *
   * An expired or already-used token is not deleted. The row is what lets the second click be
   * answered accurately instead of as "no such link"; the sweep removes it later.
   */
  async consume(token: string, purpose: VerificationPurpose): Promise<ConsumeResult> {
    const existing = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.hash(token) },
      select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true },
    });

    // A token minted for another purpose is "unknown" rather than "wrong purpose": presenting a
    // verification link to the reset endpoint should teach the caller nothing at all.
    if (existing === null || existing.purpose !== purpose) {
      return { ok: false, reason: 'UNKNOWN' };
    }

    if (existing.usedAt !== null) {
      return { ok: false, reason: 'ALREADY_USED' };
    }

    if (existing.expiresAt.getTime() <= this.clock.nowMs()) {
      return { ok: false, reason: 'EXPIRED' };
    }

    const { count } = await this.prisma.verificationToken.updateMany({
      where: { id: existing.id, usedAt: null },
      data: { usedAt: this.clock.now() },
    });

    if (count === 0) {
      // Someone else spent it between the read and the write.
      return { ok: false, reason: 'ALREADY_USED' };
    }

    return { ok: true, userId: existing.userId };
  }

  /**
   * Marks every outstanding link of one purpose as spent.
   *
   * Called once an address is verified: the links still sitting in that inbox have nothing left to
   * do, and each one is a live secret for up to 24 hours. Also what #27 will use so that a
   * completed reset invalidates the older reset emails.
   */
  async spendAllFor(userId: string, purpose: VerificationPurpose): Promise<number> {
    const { count } = await this.prisma.verificationToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: this.clock.now() },
    });

    return count;
  }

  /**
   * How many links of this purpose were issued to this account in the last hour.
   *
   * This is the whole of the "3 per hour" limit in I17, and it is deliberately not the rate
   * limiter #28 builds. That one is per IP and protects against password guessing; this one is per
   * account and protects Brevo's ~300-messages-a-day quota, which is shared by the entire
   * marketplace — one person holding down a resend button would otherwise spend everybody's
   * dispute notifications and deadline warnings for the day.
   *
   * Counted from the rows themselves rather than from a counter in memory, so it survives a
   * restart and cannot drift.
   */
  async issuedInTheLastHour(userId: string, purpose: VerificationPurpose): Promise<number> {
    return this.prisma.verificationToken.count({
      where: {
        userId,
        purpose,
         
        createdAt: { gt: new Date(this.clock.nowMs() - MS_PER_HOUR) },
      },
    });
  }

  /**
   * Removes links that have expired. Returns how many went.
   *
   * Called by the sweep, never by a request. An expired row cannot be spent — `consume` checks —
   * so it is no longer evidence of anything. Rows that were spent but have not yet expired stay
   * until they do, which is what keeps "you have already used this link" answerable for the day
   * after someone clicks twice.
   */
  async deleteExpired(now: Date): Promise<number> {
    const { count } = await this.prisma.verificationToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return count;
  }

  private hash(token: string): string {
    return createHmac('sha256', this.config.verificationTokenSecret).update(token).digest('hex');
  }
}
