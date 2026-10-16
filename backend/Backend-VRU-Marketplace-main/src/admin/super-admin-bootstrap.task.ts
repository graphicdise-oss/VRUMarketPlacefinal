import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { normaliseEmail } from '../auth/email-address.js';
import { describeErrorForLog } from '../common/errors/error-kind-for-log.js';
import { AppConfig } from '../config/app-config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { SweepService } from '../time/sweep.service.js';
import { SweepTask } from '../time/sweep.js';
import { FirstGrantRefusal, SuperAdminGrantService } from './super-admin-grant.service.js';

/** What the deployer reads in the log when SUPER_ADMIN_EMAIL cannot be made the first super admin. */
const REFUSAL_FOR_LOG: Record<Exclude<FirstGrantRefusal, 'LOST_RACE' | 'ALREADY_SUPER_ADMIN'>, string> = {
  SUPER_ADMIN_BANNED: 'that account is a super admin, but banned',
  BANNED: 'that account is banned',
  UNVERIFIED: 'that account has not verified its email yet',
  OPEN_SHOP: 'that account still runs an open shop (N29)',
  ERASED: 'the account at that address was erased — set SUPER_ADMIN_EMAIL to someone else',
};

/** What one pass did — for the sweep report, and for the log line the deployer reads. */
type BootstrapOutcome = 'already-has-super-admin' | 'invited' | 'promoted' | 'not-eligible';

/**
 * §124 (K2, owner's decision — option ค): the platform's first super admin, from
 * `SUPER_ADMIN_EMAIL`, with nothing for whoever deploys to do but set that one line and start the
 * system once.
 *
 * While there is no super admin able to act (one not banned and not erased), the address goes
 * through `SuperAdminGrantService.grantFirst`: a verified account is promoted under the same rules a
 * super admin's appointment uses (§125), and an address with no account — here only, never in an
 * appointment — gets an invitation. Anything else is refused, which this task logs once per reason.
 * Wherever a pass refuses, nothing is created and nothing is sent.
 *
 * Why no password in `.env` (the alternative the owner weighed): a password there sits readable on
 * the server for as long as nobody remembers to remove it, and proves nothing about the address —
 * a mistyped address with a known password is a super admin account someone else can take over by
 * resetting it. Here the only ways in prove that mailbox: the link in it, or Google signing in
 * with it, which claims the invited account (§124 · `isInvitedSuperAdmin` · `GoogleAuthService`).
 *
 * Runs once at boot, so the invitation goes out within seconds of the first start, and on the one
 * sweep (M5) — which is how a test reaches it, and which also picks up a promotion due once its
 * owner verifies. An unclaimed invitation is never sent again: the account it created already
 * counts as the super admin, and an expired link is replaced through "forgot password" like any
 * other (`PasswordResetService.request` sends a link to an account with neither a password nor
 * Google).
 */
@Injectable()
export class SuperAdminBootstrapTask implements SweepTask, OnModuleInit, OnApplicationBootstrap {
  readonly sweepName = 'admin.bootstrapSuperAdmin';
  private readonly logger = new Logger(SuperAdminBootstrapTask.name);
  private lastWarning: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly grants: SuperAdminGrantService,
    private readonly sweep: SweepService,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  /** At boot, without waiting for the first sweep — and never failing the boot over it. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.runSweep(this.clock.now());
    } catch (error) {
      this.logger.error('Could not check for a first super admin at boot; the next sweep will try again.', describeErrorForLog(error));
    }
  }

  async runSweep(_now: Date): Promise<number> {
    const outcome = await this.ensureSuperAdmin();

    return outcome === 'invited' || outcome === 'promoted' ? 1 : 0;
  }

  private async ensureSuperAdmin(): Promise<BootstrapOutcome> {
    const active = await this.prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', bannedAt: null, erasedAt: null },
      select: { id: true },
    });
    if (active !== null) {
      return 'already-has-super-admin';
    }

    const result = await this.grants.grantFirst(normaliseEmail(this.config.superAdminEmail));

    if ('refused' in result) {
      // Another pass (or a person signing up) got there between the check above and the grant.
      if (result.refused === 'LOST_RACE' || result.refused === 'ALREADY_SUPER_ADMIN') {
        return 'already-has-super-admin';
      }
      this.warnOnce(REFUSAL_FOR_LOG[result.refused]);
      return 'not-eligible';
    }

    if (result.granted === 'PROMOTED') {
      this.logger.log('The SUPER_ADMIN_EMAIL account was already verified and is now the super admin.');
      return 'promoted';
    }
    if (result.invitation.sent) {
      // The address is not logged (CLAUDE.md); whoever deployed knows what they configured.
      this.logger.log('Invited the first super admin: a link to set a password was sent to SUPER_ADMIN_EMAIL.');
    } else {
      this.logger.warn(`Created the first super admin, but the invitation could not be sent (${result.invitation.reason}). Use "forgot password" with SUPER_ADMIN_EMAIL once email works.`);
    }
    return 'invited';
  }

  /**
   * Once per reason per process: the sweep comes round every five minutes, and a line repeated all
   * day is a log nobody reads — but a reason that changes (unverified, then banned) is news.
   */
  private warnOnce(reason: string): void {
    if (this.lastWarning !== reason) {
      this.lastWarning = reason;
      this.logger.warn(`No super admin yet, and SUPER_ADMIN_EMAIL cannot be made one: ${reason}.`);
    }
  }
}
