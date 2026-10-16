import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AccountErasureService } from '../account-erasure/account-erasure.service.js';
import { newId } from '../common/id.js';
import { CURRENT_PRIVACY_POLICY_VERSION, CURRENT_TERMS_OF_SERVICE_VERSION, signupAcceptances } from '../legal/policy-version.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { AccountMarkerService } from './account-marker.service.js';
import { GoogleIdentity } from './google-identity.js';
import { IssuedTokens, SessionService } from './session.service.js';

/**
 * Why a Google sign-in did not end in a session.
 *
 * These names reach the frontend, as the `error` parameter on the page Google's callback redirects
 * to — so they are part of the API contract and are written down in FRONTEND-NOTES.md. Some match
 * the error codes the JSON endpoints use (`ACCOUNT_BANNED`, `POLICY_VERSION_OUTDATED`) because they
 * mean the same thing to the person reading the screen, and a frontend that already handles those
 * should not need a second vocabulary for the same situations. (`EMAIL_NOT_VERIFIED` left this list
 * in §101: sending its owner to verify the address was how a squatted account got handed over.)
 */
export const GOOGLE_SIGN_IN_REFUSALS = [
  /** Google itself says the address is not verified, so it proves nothing. */
  'GOOGLE_EMAIL_UNVERIFIED',
  /**
   * §101: there is a verified account with this address and a password, not yet connected to
   * Google. Sign in with that password first, then press the Google button while signed in.
   */
  'GOOGLE_LINK_REQUIRES_PASSWORD',
  'ACCOUNT_BANNED',
  /**
   * §87: a new account, and the page did not send the current privacy policy version — the same
   * name and meaning as `/auth/register`'s error code, so the frontend reloads the policy and asks
   * again the same way on both paths.
   */
  'POLICY_VERSION_OUTDATED',
  /** §98: a new account, and the page did not confirm age 20+ or a guardian's consent. */
  'AGE_CONFIRMATION_REQUIRED',
  /** Anything else: a bad state, an expired code, Google unreachable, a refused registration. */
  'GOOGLE_SIGN_IN_FAILED',
  /**
   * §128: this deployment has no Google client configured. Not a failure to retry — the frontend
   * hides its buttons when `GET /auth/google/status` says so, and this covers a stale page or a
   * typed-in link.
   */
  'GOOGLE_SIGN_IN_DISABLED',
] as const;

export type GoogleSignInRefusal = (typeof GOOGLE_SIGN_IN_REFUSALS)[number];

export type GoogleSignInResult =
  | { readonly status: 'signed-in'; readonly tokens: IssuedTokens; readonly userId: string }
  | { readonly status: 'refused'; readonly reason: GoogleSignInRefusal };

/**
 * Signing in with Google, and the rules that decide when that may enter an existing account.
 *
 * #26 calls itself the most dangerous ticket of this topic, and the danger is one specific move:
 * somebody registers `victim@gmail.com` here, sets a password they know, and waits. If arriving
 * with a Google account for that address handed over the row with that password still on it, they
 * would share an account with the victim — without ever reading the victim's email.
 *
 * §101 (scrutinizing area 3 found the old rule let exactly that through): the old answer refused an
 * unverified row and sent its owner to "request a new verification link" — which verified the
 * squatter's account, password and session intact, for the owner to sign into with Google. The
 * owner chose both halves of the practice the pre-account-hijacking research recommends:
 *
 *   - **An unverified account belongs to nobody yet.** Google's proof of the address wins: that
 *     account is retired (`retireUnproven`) — its password, sessions and links end with it, and
 *     nothing made on it comes along — and the owner starts a fresh account, consenting for
 *     themselves like any new one.
 *   - **A verified account with a password is connected to Google only by someone who proves that
 *     password** — who is signed in with it when the Google sign-in comes back. Anyone else is told
 *     GOOGLE_LINK_REQUIRES_PASSWORD. This also closes what the first half leaves: an owner who
 *     clicked the verification link a squatter's registration sent them still cannot be signed into
 *     the squatter's account by Google; "forgot password" takes it back (#27 ends every session).
 *   - **Once connected, an account is recognised by Google's own id (`sub`),** and the same address
 *     arriving with a different id is refused — an address can come back attached to another Google
 *     account (a workplace account deleted and recreated).
 *
 * Google must still say `email_verified`, or Google is only repeating a string back to us.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleIdentity,
    private readonly sessions: SessionService,
    private readonly markers: AccountMarkerService,
    private readonly services: ModuleRef,
    private readonly clock: Clock,
  ) {}

  /** Where to send the browser. The caller stores `state` in a cookie first. */
  authorisationUrl(state: string): string {
    return this.google.authorisationUrl(state);
  }

  /**
   * @param signedInUserId the account the browser is already signed in to, if any — the proof of
   *   password §101 asks for before Google is connected to a verified account that has one.
   */
  async signInWithCode(
    code: string,
    acceptedPolicyVersion: string | undefined,
    acceptedTermsVersion: string | undefined,
    ageConfirmed: boolean,
    signedInUserId: string | null,
  ): Promise<GoogleSignInResult> {
    const exchange = await this.google.exchangeCode(code);

    if (!exchange.ok) {
      // The reason names Google and a status, never the code and never a token.
      this.logger.warn(`A Google sign-in could not be completed: ${exchange.reason}`);
      return { status: 'refused', reason: 'GOOGLE_SIGN_IN_FAILED' };
    }

    const { email, emailVerified, subject } = exchange.account;

    if (!emailVerified) {
      this.logger.debug('A Google sign-in was refused: Google has not verified that address.');
      return { status: 'refused', reason: 'GOOGLE_EMAIL_UNVERIFIED' };
    }

    const connected = await this.findBySubject(subject);
    if (connected !== null) {
      return this.signInToConnected(connected);
    }

    const existing = await this.findByEmail(email);
    const unproven = existing !== null && isUnproven(existing);

    if (existing !== null && !unproven) {
      return this.signInToExisting(existing, subject, signedInUserId);
    }

    // K16: an address whose previous account was banned may not come back — by any door. Checking
    // it here as well as in `register` is the point: a rule enforced on one of two entrances is a
    // rule that is not enforced.
    if (await this.markers.wasBanned(email)) {
      this.logger.debug('A Google sign-in was refused: the address belongs to a banned account.');
      return { status: 'refused', reason: 'GOOGLE_SIGN_IN_FAILED' };
    }

    // §87: only a new account needs it — an existing one accepted a policy when it was created.
    // §90: the terms version behind the same checkbox, checked the same way.
    // §101: an unproven account's acceptance was somebody's, not necessarily this person's — they
    // are asked for their own, and refused before the unproven account is touched.
    if (
      acceptedPolicyVersion !== CURRENT_PRIVACY_POLICY_VERSION ||
      acceptedTermsVersion !== CURRENT_TERMS_OF_SERVICE_VERSION
    ) {
      return { status: 'refused', reason: 'POLICY_VERSION_OUTDATED' };
    }

    // §98: the same second box the sign-up form has — only a new account is asked, like the above.
    if (!ageConfirmed) {
      return { status: 'refused', reason: 'AGE_CONFIRMATION_REQUIRED' };
    }

    if (unproven && !(await this.retireUnproven(existing.id))) {
      return { status: 'refused', reason: 'GOOGLE_SIGN_IN_FAILED' };
    }

    return this.createAccountFor(email, subject);
  }

  /**
   * §101: an account nobody has proven — unverified, never connected to Google, not banned — is
   * retired so that Google's proven owner of the address starts a fresh one.
   *
   * Retired rather than handed over: whatever was made on it before anybody proved the address stays
   * with it — a default delivery address that would receive the owner's first order, chat messages,
   * the acceptance and age box somebody else ticked. Retiring is the PDPA erasure's overwrite
   * (`AccountErasureService.retireUnproven`), which ends every session and link, anonymizes what the
   * account wrote and frees the address — without the parts that belong to somebody's own request
   * (the completion email, the marker). An unverified account cannot have ordered or opened a shop
   * (both need a verified address), so nothing holds it back; one verified at the same moment is not
   * retired, and the sign-in is refused to be tried again.
   *
   * Looked up through `ModuleRef` rather than injected: `AccountErasureModule` imports this module,
   * so a constructor dependency the other way would be a cycle.
   */
  private async retireUnproven(userId: string): Promise<boolean> {
    const retired = await this.services.get(AccountErasureService, { strict: false }).retireUnproven(userId);
    if (retired) {
      this.logger.log('A Google sign-in retired an unverified account registered with the same address.');
    }
    return retired;
  }

  /** An account already connected to this Google account — recognised by Google's id (§101). */
  private async signInToConnected(user: ExistingUser): Promise<GoogleSignInResult> {
    if (user.bannedAt !== null) {
      return { status: 'refused', reason: 'ACCOUNT_BANNED' };
    }
    return { status: 'signed-in', tokens: await this.sessions.issue(user.id), userId: user.id };
  }

  /**
   * An account exists for this verified address, not connected to this Google account (§101).
   *
   * Signing in never sets a password and never edits the account beyond what the rules on the class
   * say: connecting records Google's id, and adopting an unverified account is the one case that
   * clears a password — one nobody ever proved.
   */
  private async signInToExisting(user: ExistingUser, subject: string, signedInUserId: string | null): Promise<GoogleSignInResult> {
    if (user.bannedAt !== null) {
      return { status: 'refused', reason: 'ACCOUNT_BANNED' };
    }

    if (user.googleSubject !== null) {
      // Connected to a different Google account under the same address: a recycled address.
      this.logger.debug('A Google sign-in was refused: the address is connected to another Google account.');
      return { status: 'refused', reason: 'GOOGLE_SIGN_IN_FAILED' };
    }

    if (user.hasPassword && signedInUserId !== user.id) {
      this.logger.debug('A Google sign-in was refused: connecting needs the account’s password proven first.');
      return { status: 'refused', reason: 'GOOGLE_LINK_REQUIRES_PASSWORD' };
    }

    // Proven by a session signed in with the password — or there is no password to prove: an
    // account created with Google before §101, which never recorded Google's id.
    return this.connect(user, subject);
  }

  /** Records Google's id on an account the caller has shown is theirs, and signs them in. */
  private async connect(user: ExistingUser, subject: string): Promise<GoogleSignInResult> {
    const connected = await this.prisma.user
      .updateMany({ where: { id: user.id, googleSubject: null, erasedAt: null }, data: { googleSubject: subject } })
      .catch(countZeroOnUniqueViolation);

    if (connected.count === 0) {
      // Another request wrote first. Signed in only if what it wrote is this very connection — a
      // double-clicked button; anything else is refused rather than decided again, so this can
      // never go round in a loop with the request that beat it.
      const now = await this.findBySubject(subject);
      return now?.id === user.id ? this.signInToConnected(now) : { status: 'refused', reason: 'GOOGLE_SIGN_IN_FAILED' };
    }

    return { status: 'signed-in', tokens: await this.sessions.issue(user.id), userId: user.id };
  }

  /**
   * First time here: a new account with no password.
   *
   * `emailVerifiedAt` is set immediately, and that is not a shortcut — Google has just told us it
   * verified the address, which is the same fact our own verification email establishes. Sending a
   * verification email to an address Google has verified would ask the person to prove something
   * twice and would leave them unable to order until they did.
   *
   * `passwordHash` stays null, which is the distinction #27 reads to answer "this account signs in
   * with Google" instead of emailing a reset link for a password that does not exist.
   *
   * The privacy policy acceptance is recorded here too (#75 · §66), and since §90 the terms of
   * service acceptance beside it. The form on this path is the page around the Google button: §90
   * has the owner's decision that the button stays disabled until the same checkbox the sign-up
   * form uses is ticked (FRONTEND-NOTES.md). Since §87 the page sends the policy version it showed,
   * since §90 the terms version too, and `signInWithCode` refuses to get here unless both are
   * current. Leaving the rows out instead would have made Google the quiet way around the
   * requirement, and would have left a population of accounts with no acceptance behind them for
   * nobody to notice later.
   */
  private async createAccountFor(email: string, subject: string): Promise<GoogleSignInResult> {
    const now = this.clock.now();

    try {
      const created = await this.prisma.user.create({
        data: {
          id: newId(),
          email,
          passwordHash: null,
          emailVerifiedAt: now,
          googleSubject: subject,
          createdAt: now,
          // §98: `signInWithCode` refuses to get here unless the page's age box was ticked.
          ageConfirmedAt: now,
          // The current version — which `signInWithCode` has just checked is the one the page
          // showed (§87; §86 had recorded the gap this closes: a stale frontend build could show an
          // older policy than the one written here).
          // §90: the terms too, one row per document, as `register` writes them.
          policyAcceptances: { create: signupAcceptances(CURRENT_PRIVACY_POLICY_VERSION, CURRENT_TERMS_OF_SERVICE_VERSION, now) },
        },
        select: { id: true },
      });

      return { status: 'signed-in', tokens: await this.sessions.issue(created.id), userId: created.id };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      // Two callbacks for the same new address at once — a double-clicked consent screen is enough.
      // The loser re-reads the winner's row rather than failing, so both tabs end up signed in to
      // the one account instead of one of them showing an error nobody can act on.
      const connected = await this.findBySubject(subject);
      if (connected !== null) {
        return this.signInToConnected(connected);
      }
      const existing = await this.findByEmail(email);

      // Also refused: an unproven account registered again in the moment since the last one was
      // retired — answering it as a verified account would send the owner to "forgot password",
      // which would verify it for whoever registered it. Trying again retires it too.
      if (existing === null || isUnproven(existing)) {
        return { status: 'refused', reason: 'GOOGLE_SIGN_IN_FAILED' };
      }

      return this.signInToExisting(existing, subject, null);
    }
  }

  private async findByEmail(email: string): Promise<ExistingUser | null> {
    const row = await this.prisma.user.findUnique({ where: { email }, select: EXISTING_USER_SELECT });
    return row === null ? null : toExistingUser(row);
  }

  /** An erased account has let go of its Google id (§101), so this never finds one. */
  private async findBySubject(subject: string): Promise<ExistingUser | null> {
    const row = await this.prisma.user.findUnique({ where: { googleSubject: subject }, select: EXISTING_USER_SELECT });
    return row === null ? null : toExistingUser(row);
  }
}

/**
 * The password hash is read only to learn whether there is one, and dropped at once — the account
 * this answer is about never carries it further (`toExistingUser`).
 */
const EXISTING_USER_SELECT = {
  id: true,
  emailVerifiedAt: true,
  bannedAt: true,
  erasedAt: true,
  googleSubject: true,
  passwordHash: true,
} as const;

interface ExistingUser {
  readonly id: string;
  readonly emailVerifiedAt: Date | null;
  readonly bannedAt: Date | null;
  readonly googleSubject: string | null;
  readonly hasPassword: boolean;
}

/** Unverified, never connected to Google, not banned: an address claimed but never proven (§101). */
function isUnproven(user: ExistingUser): boolean {
  return user.emailVerifiedAt === null && user.googleSubject === null && user.bannedAt === null;
}

function toExistingUser(row: {
  id: string;
  emailVerifiedAt: Date | null;
  bannedAt: Date | null;
  googleSubject: string | null;
  passwordHash: string | null;
}): ExistingUser {
  return {
    id: row.id,
    emailVerifiedAt: row.emailVerifiedAt,
    bannedAt: row.bannedAt,
    googleSubject: row.googleSubject,
    hasPassword: row.passwordHash !== null,
  };
}

/** A conditional write that lost to a concurrent one on the unique Google id: nothing written. */
function countZeroOnUniqueViolation(error: unknown): { count: number } {
  if (isUniqueViolation(error)) {
    return { count: 0 };
  }
  throw error;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
