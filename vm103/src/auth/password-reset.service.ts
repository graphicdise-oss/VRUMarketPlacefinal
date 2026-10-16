import { Injectable, Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app-exception.js';
import { errorKindForLog } from '../common/errors/error-kind-for-log.js';
import { EmailMessage, EmailSender } from '../email/email-sender.js';
import { FrontendLinks } from '../email/frontend-links.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { PASSWORD_RESET_EMAILS_PER_HOUR, PASSWORD_RESET_TTL_HOURS } from './auth-policy.js';
import { normaliseEmail } from './email-address.js';
import { hashPassword } from './password.js';
import { SessionService } from './session.service.js';
import { VerificationTokenService } from './verification-token.service.js';

/**
 * Getting back into an account nobody can be asked to unlock for you (I16).
 *
 * There is no support desk behind this marketplace, so this flow is the only way back in — which
 * is also why it is the flow an attacker would most like to abuse. Three rules shape everything
 * here, and each of them costs something:
 *
 *   1. **The answer never says whether the address is registered.** Unknown, banned, already over
 *      the hourly limit, or a real account with a link on its way: one 202 with an empty body.
 *      Otherwise this endpoint is a membership list anyone can read one request at a time — and in
 *      a marketplace where a community's members are identifiable from their shops, that list is
 *      worth having to somebody.
 *   2. **A completed reset ends every session** (see `complete`). A good share of the people who
 *      use this are here because somebody else got in; leaving the intruder's session alive would
 *      make the new password decorative.
 *   3. **A Google-only account is told by email, not by the response.** The friendly sentence —
 *      "this account signs in with Google" — is true and useful, and saying it in the response
 *      would announce that the address has an account here. It goes to the mailbox instead,
 *      which only its owner can read.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VerificationTokenService,
    private readonly sessions: SessionService,
    private readonly email: EmailSender,
    private readonly links: FrontendLinks,
    private readonly clock: Clock,
  ) {}

  /**
   * Sends a reset link, or a "you sign in with Google" note, or nothing at all — and the caller
   * cannot tell which.
   *
   * ⚠️ **The mail provider is deliberately not awaited.** I16 requires that the timing of this
   * answer not give away what happened, and a real Brevo round trip is several hundred
   * milliseconds that an unknown address would not spend. What the request *does* wait for is this
   * system's own database, which both paths touch, so the difference left over is one INSERT.
   *
   * The cost of that choice is that a send failure is logged after the response has gone, rather
   * than being something the caller could be told about. N12 already settled that the caller must
   * not be told about it anyway.
   */
  async request(rawAddress: string): Promise<void> {
    const address = normaliseEmail(rawAddress);

    const user = await this.prisma.user.findUnique({
      where: { email: address },
      select: { id: true, passwordHash: true, bannedAt: true },
    });

    if (user === null || user.bannedAt !== null) {
      // No account, or one that is not to be helped back in. Nothing is logged about which address
      // it was: a log of refused resets is a list of this marketplace's members in a file that is
      // easier to read than the database.
      return;
    }

    if (
      (await this.tokens.issuedInTheLastHour(user.id, 'PASSWORD_RESET')) >=
      PASSWORD_RESET_EMAILS_PER_HOUR
    ) {
      this.logger.debug('A password-reset request was skipped: the hourly limit was reached.');
      return;
    }

    // Issued in both branches, and in the Google-only branch the value is thrown away unread.
    // That looks odd for one line and closes a real hole: the hourly allowance is a count of rows,
    // so a branch that sends an email without recording one could be asked for that email without
    // limit. A token nobody has ever seen cannot be spent — it is 256 bits of randomness that
    // never left this process — so recording it costs nothing but the row.
    const token = await this.tokens.issue(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_HOURS);

    this.sendWithoutWaiting(
      user.passwordHash === null
        ? this.googleOnlyNotice(address)
        : this.resetLinkEmail(address, token),
    );
  }

  /**
   * Spends a link and sets the new password.
   *
   * Unknown, expired and already-used all come back as one code, for the same reason #25's
   * verification does: the person's next move is identical in all three cases, and telling them
   * apart would let somebody test guessed tokens for existence.
   *
   * Three things happen after the password is written, and the order is not arbitrary. Every other
   * outstanding reset link is spent first (each is a live temporary password sitting in an inbox),
   * and only then is every session revoked — so that a failure partway through leaves the account
   * with fewer ways in rather than more.
   */
  async complete(token: string, newPassword: string): Promise<void> {
    const result = await this.tokens.consume(token, 'PASSWORD_RESET');

    if (!result.ok) {
      this.logger.debug(`A password-reset link was rejected: ${result.reason}`);
      throw new AppException('RESET_LINK_INVALID');
    }

    const passwordHash = await hashPassword(newPassword);
    const now = this.clock.now();

    // Two statements in one transaction rather than one update, because the second must not
    // overwrite an existing value:
    //
    //   - the password is replaced unconditionally;
    //   - the address is marked verified **only if it was not already**, so an account that was
    //     verified two years ago keeps the date it was verified on rather than being restamped
    //     every time its owner forgets a password.
    //
    // Marking it at all is the part worth explaining. Clicking a link delivered to that inbox
    // proves the address as thoroughly as the verification email does, and that is not a
    // convenience: it is what stops N15's linking rule from stranding somebody whose address was
    // registered by a squatter they cannot ask to verify it.
    //
    // No check for a banned account here, deliberately. `request` refuses to send to one, so
    // reaching this point means the ban happened within the last hour, and a banned account's
    // password is of no consequence — `login` refuses it either way. Refusing here would need a
    // code that either lies or announces the ban to whoever is holding the link.
    //
    // §96: both writes skip an erased account. Erasure spends every outstanding link, but one
    // already consumed a moment before it committed would otherwise put a password back on the
    // anonymized row — answered as the same invalid link, since that is what it has become.
    const [written] = await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { id: result.userId, erasedAt: null }, data: { passwordHash } }),
      this.prisma.user.updateMany({
        where: { id: result.userId, erasedAt: null, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      }),
    ]);
    if (written.count === 0) {
      throw new AppException('RESET_LINK_INVALID');
    }

    await this.tokens.spendAllFor(result.userId, 'PASSWORD_RESET');

    // I16's real requirement. Whoever was signed in before this — including the person doing the
    // reset, on their other devices — is signed out, because a fair number of the people who reach
    // this flow are here because somebody else is already inside.
    const ended = await this.sessions.revokeAllForUser(result.userId);

    // A count, with no address and no id attached: how many sessions a reset ends is operationally
    // interesting and says nothing about who it was.
    this.logger.log(`A password reset ended ${String(ended)} session(s).`);
  }

  private resetLinkEmail(address: string, token: string): EmailMessage {
    return {
      to: address,
      kind: 'PASSWORD_RESET',
      subject: 'ตั้งรหัสผ่านใหม่ — VRU Marketplace',
      body: [
        'สวัสดีครับ',
        '',
        'มีคนขอตั้งรหัสผ่านใหม่ให้บัญชีที่ใช้อีเมลนี้ กดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่',
        '',
        this.links.passwordReset(token),
        '',
        `ลิงก์นี้ใช้ได้ ${PASSWORD_RESET_TTL_HOURS} ชั่วโมง และใช้ได้ครั้งเดียว`,
        'เมื่อตั้งรหัสผ่านใหม่สำเร็จ อุปกรณ์ทุกเครื่องที่ยังล็อกอินค้างอยู่จะถูกออกจากระบบทั้งหมด',
        '',
        'ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไรกับอีเมลฉบับนี้ รหัสผ่านเดิมยังใช้ได้ตามปกติ',
      ].join('\n'),
    };
  }

  /**
   * The answer for an account that has no password because it was created through Google (#26).
   *
   * Sent to the address rather than returned to the caller — see rule 3 on the class. It is also
   * why the person is not left confused: without it, asking for a reset on such an account would
   * produce the same "check your inbox" message and then no email at all.
   */
  private googleOnlyNotice(address: string): EmailMessage {
    return {
      to: address,
      kind: 'PASSWORD_RESET',
      subject: 'บัญชีนี้เข้าสู่ระบบด้วย Google — VRU Marketplace',
      body: [
        'สวัสดีครับ',
        '',
        'มีคนขอตั้งรหัสผ่านใหม่ให้บัญชีที่ใช้อีเมลนี้',
        'บัญชีนี้เข้าสู่ระบบด้วย Google จึงไม่มีรหัสผ่านให้ตั้งใหม่',
        '',
        'กรุณากลับไปที่หน้าเข้าสู่ระบบแล้วกดปุ่ม "เข้าสู่ระบบด้วย Google"',
        '',
        'ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไรกับอีเมลฉบับนี้',
      ].join('\n'),
    };
  }

  /**
   * Hands a message to the provider and returns immediately.
   *
   * The promise is consumed here rather than left floating — a dropped rejection is a silently
   * lost failure, and the lint rule that forbids one is right. What is given up is the ability to
   * answer differently when sending fails, which this flow must not do anyway.
   */
  private sendWithoutWaiting(message: EmailMessage): void {
    void this.email
      .send(message)
      .then((result) => {
        if (!result.sent) {
          // The provider's reason, which is about the provider. No address and no link.
          this.logger.warn(
            `A password-reset email was not sent (retryable: ${String(result.retryable)}): ${result.reason}`,
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.error(
          `The email provider threw while sending a password-reset email: ${errorKindForLog(error)}`,
        );
      });
  }
}
