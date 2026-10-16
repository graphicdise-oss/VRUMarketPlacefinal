import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { CURRENT_PRIVACY_POLICY_VERSION, CURRENT_TERMS_OF_SERVICE_VERSION, signupAcceptances } from '../legal/policy-version.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { AccountMarkerService } from './account-marker.service.js';
import { CurrentUser } from './authenticated-request.js';
import { normaliseEmail } from './email-address.js';
import { EmailVerificationService } from './email-verification.service.js';
import { hashPassword, verifyPassword, wasteVerificationTime } from './password.js';
import { IssuedTokens, SessionService } from './session.service.js';

/**
 * Registering and signing in.
 *
 * Knows nothing about cookies, headers or status codes — the controller turns what this returns
 * into a response (CLAUDE.md: "service ไม่รู้จัก req / res"). That is not only tidiness here:
 * topic 11's websocket has to authenticate a handshake, and it reaches for SessionService rather
 * than for anything shaped like an HTTP request.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly verification: EmailVerificationService,
    private readonly markers: AccountMarkerService,
    private readonly clock: Clock,
  ) {}

  /**
   * §112: the communities this account administers, for `GET /auth/me` — the frontend's one way to
   * know which admin screens to offer, since a community admin's platform `role` is plain `USER`.
   */
  async adminCommunityIdsOf(userId: string): Promise<string[]> {
    const rows = await this.prisma.communityAdmin.findMany({ where: { userId }, select: { communityId: true }, orderBy: { id: 'asc' } });

    return rows.map((row) => row.communityId);
  }

  /**
   * Creates an account, or does nothing at all, and never says which.
   *
   * #24 and I16 both require that the answer not reveal whether an address is already registered.
   * Three things had to line up for that to be true rather than merely intended:
   *
   *   1. The controller answers 202 with an empty body in both cases, so there is nothing to
   *      compare.
   *   2. Registration does **not** sign the new account in. Returning cookies on success would
   *      announce the outcome louder than any message could, and it is the wrong flow anyway:
   *      #25 sends a verification email from here and the person arrives back through it.
   *   3. The password is hashed before the insert is attempted, so a taken address costs the same
   *      ~85ms as a free one. Checking first and returning early would have made the difference
   *      measurable with a stopwatch.
   *
   * The duplicate is caught from the unique constraint rather than pre-checked, which also closes
   * the race between a check and an insert — two simultaneous registrations for one address end
   * with one account, not with a 500 from the second.
   */
  async register(
    email: string,
    password: string,
    acceptedPrivacyPolicyVersion: string,
    acceptedTermsOfServiceVersion: string,
  ): Promise<void> {
    // Before the hashing, and before anything that touches the address: this refusal depends only
    // on what the build is serving, so answering it early leaks nothing about who has an account
    // here. It is also the one refusal on this path the caller is told about — I16 keeps the rest
    // silent, but "your page is out of date" is not a fact about any account.
    if (
      acceptedPrivacyPolicyVersion !== CURRENT_PRIVACY_POLICY_VERSION ||
      acceptedTermsOfServiceVersion !== CURRENT_TERMS_OF_SERVICE_VERSION
    ) {
      throw new AppException('POLICY_VERSION_OUTDATED');
    }

    const normalisedEmail = normaliseEmail(email);
    const passwordHash = await hashPassword(password);

    // K16: an address whose previous account was banned may not come back. Checked after hashing
    // rather than before, so that a refused registration costs the same ~85ms as an accepted one —
    // the controller answers 202 either way, and timing is the remaining way to tell them apart.
    if (await this.markers.wasBanned(normalisedEmail)) {
      // Nothing is logged about which address this was. A log of refused registrations is a list
      // of people who were banned, in a file that is easier to read than the database.
      this.logger.debug('Registration refused: the address belongs to a banned, erased account.');
      return;
    }

    const now = this.clock.now();

    try {
      const created = await this.prisma.user.create({
        data: {
          id: newId(),
          email: normalisedEmail,
          passwordHash,
          // Unverified. The link goes out below; ordering and opening a shop are what will
          // eventually require it (B0.1 · K4), and neither exists yet.
          emailVerifiedAt: null,
          createdAt: now,
          // §98: `RegisterDto` refuses a sign-up that did not tick the age box, so reaching here
          // means it was ticked.
          ageConfirmedAt: now,
          // Nested rather than a second statement, so there is no window — not even one that only
          // opens when the process dies mid-registration — in which an account exists with no
          // acceptance behind it. Prisma runs a nested create in the same transaction as its
          // parent, so the duplicate-address rollback below takes this row with it (#75 · §66).
          // §90: one row per document behind the one checkbox, in the same nested create.
          policyAcceptances: { create: signupAcceptances(acceptedPrivacyPolicyVersion, acceptedTermsOfServiceVersion, now) },
        },
        select: { id: true },
      });

      // Outside the create but inside the try, so a duplicate address never reaches it: sending to
      // an address that already has an account would tell its owner that somebody is trying to
      // register as them, which is a message nobody asked this system to send.
      //
      // This cannot fail the registration — see sendOnRegistration for why the account is worth
      // more than the email.
      await this.verification.sendOnRegistration(created.id, normalisedEmail);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Deliberately swallowed. Nothing is logged about which address it was, either: a log of
        // "someone tried to register an address that already exists" is a list of this system's
        // members, sitting in a file that is easier to read than the database.
        this.logger.debug('Registration for an address that already exists; answering as usual.');
        return;
      }

      throw error;
    }
  }

  /**
   * Checks an email and password and starts a session.
   *
   * Every failure is the same code and the same message (INVALID_CREDENTIALS), whether the address
   * is unknown, the password is wrong, or the account has no password at all because it was
   * created through Google (#26). The Google case is worth being explicit about: it would be
   * friendlier to say "this account signs in with Google", and I16 settled that such a sentence
   * goes in an email to the address's owner, not in a response to whoever is typing.
   *
   * A banned account with the *correct* password is told so. That tells an attacker nothing they
   * could not already confirm by signing in, and the alternative is worse: cookies that the guard
   * then refuses on every request, leaving the person staring at a working sign-in form that
   * cannot do anything.
   */
  async login(email: string, password: string): Promise<SignedIn> {
    const normalisedEmail = normaliseEmail(email);

    const user = await this.prisma.user.findUnique({
      where: { email: normalisedEmail },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerifiedAt: true,
        passwordHash: true,
        bannedAt: true,
      },
    });

    if (user === null) {
      // The same work a real verification costs, so "no such account" and "wrong password" cannot
      // be told apart by how long the answer took.
      await wasteVerificationTime(password);
      throw new AppException('INVALID_CREDENTIALS');
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new AppException('INVALID_CREDENTIALS');
    }

    if (user.bannedAt !== null) {
      throw new AppException('ACCOUNT_BANNED');
    }

    // §91: the check above takes ~85ms, long enough for a password reset to land in between. The
    // reset changes the hash and then ends every session — but a session created a moment after
    // that would survive it, signed in with a password that no longer exists. So the session is
    // written only while the account still has the hash that was checked, under a `FOR SHARE` lock
    // the reset's own write waits on: either this commits first and the reset's revocation ends
    // it, or the reset commits first and this is refused like any other wrong password.
    const tokens = await this.prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ password_hash: string | null }[]>`SELECT password_hash FROM "user" WHERE id = ${user.id}::uuid FOR SHARE`;
      if (current === undefined || current.password_hash !== user.passwordHash) {
        throw new AppException('INVALID_CREDENTIALS');
      }
      return this.sessions.issue(user.id, tx);
    });

    return {
      tokens,
      // Returned from the row this method already read, rather than leaving the controller to
      // look the new session up again to find out whose it is. The fields are the same ones
      // AuthGuard resolves on every later request, so the answer here and the answer from
      // /auth/me are built from one definition of what a caller is.
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerifiedAt !== null,
      },
    };
  }
}

/** What a successful sign-in produces: cookies for the controller, and who it was. */
export interface SignedIn {
  readonly tokens: IssuedTokens;
  readonly user: CurrentUser;
}

/**
 * Whether Prisma is reporting a unique-constraint violation (P2002).
 *
 * Matched on the code rather than the message, which names the constraint and the column and is
 * not something to branch on — or to let near a response (see toErrorPayload).
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
