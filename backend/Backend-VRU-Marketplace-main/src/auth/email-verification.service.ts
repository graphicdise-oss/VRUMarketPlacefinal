import { Injectable, Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app-exception.js';
import { errorKindForLog } from '../common/errors/error-kind-for-log.js';
import { EmailMessage, EmailResult, EmailSender } from '../email/email-sender.js';
import { FrontendLinks } from '../email/frontend-links.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  VERIFICATION_EMAILS_PER_HOUR,
} from './auth-policy.js';
import { normaliseEmail } from './email-address.js';
import { VerificationTokenService } from './verification-token.service.js';

/**
 * Proving that whoever registered an address can read it.
 *
 * This is the first thing in the system to actually send an email, which makes it the ticket that
 * proves `EmailSender` (#19) works rather than merely compiles — #19 shipped the interface and the
 * fake with nothing calling either.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VerificationTokenService,
    private readonly email: EmailSender,
    private readonly links: FrontendLinks,
    private readonly clock: Clock,
  ) {}

  /**
   * Issues a link and emails it. Called after registration, and again by "resend".
   *
   * A failure to send does **not** fail the caller. #19 left this decision to topic 2 explicitly,
   * and there is only one defensible answer for registration: the account row already exists, so
   * failing the request would strand the person — they cannot register again (the second attempt
   * answers identically and does nothing) and they have no email to act on. Succeeding leaves them
   * with an account and a working "resend" button.
   *
   * The failure is logged with the provider's reason, which is about the provider and not about
   * the person; the address is not logged, and neither is the link.
   */
  private async sendLink(userId: string, address: string): Promise<void> {
    const token = await this.tokens.issue(
      userId,
      'EMAIL_VERIFICATION',
      EMAIL_VERIFICATION_TTL_HOURS,
    );

    let result: EmailResult;
    try {
      result = await this.email.send(this.verificationEmail(address, token));
    } catch (error) {
      // §104 review: a throw that escaped here reached the exception filter, which logs the stack
      // (message and all), and turned the resend into a 500 — only for an address with an
      // unverified account, which answers I16's question for the caller.
      this.logger.error(`The email provider threw while sending a verification email: ${errorKindForLog(error)}`);
      return;
    }

    if (!result.sent) {
      this.logger.warn(
        `A verification email was not sent (retryable: ${String(result.retryable)}): ${result.reason}`,
      );
    }
  }

  private verificationEmail(address: string, token: string): EmailMessage {
    return {
      to: address,
      kind: 'EMAIL_VERIFICATION',
      subject: 'ยืนยันอีเมลของคุณ — VRU Marketplace',
      // Plain text, as EmailSender requires. The link is on its own line so that every mail client
      // makes it clickable, and the expiry is stated because a link that silently stops working is
      // the most common way this flow wastes somebody's afternoon.
      body: [
        'สวัสดีครับ',
        '',
        'กรุณากดลิงก์ด้านล่างเพื่อยืนยันอีเมลของคุณ',
        '',
        this.links.emailVerification(token),
        '',
        `ลิงก์นี้ใช้ได้ ${EMAIL_VERIFICATION_TTL_HOURS} ชั่วโมง และใช้ได้ครั้งเดียว`,
        'ถ้าคุณไม่ได้สมัครสมาชิก ไม่ต้องทำอะไรกับอีเมลฉบับนี้',
      ].join('\n'),
    };
  }

  /**
   * Sends the first link, at registration.
   *
   * Never refused by the hourly limit — a registration that succeeded and sent nothing would leave
   * an account nobody can reach — but the email it sends is counted by it, so the allowance for
   * the rest of that hour is two. See VERIFICATION_EMAILS_PER_HOUR for why that reading of I17.
   *
   * Registration has its own protection against being used as a mail cannon: #28's per-IP limit.
   *
   * Deliberately **not** routed through the shared `sendLink` — this is the one caller that must
   * not wait on the Brevo round trip. Found in /code-review of #24/#25 (DECISIONS.md §73):
   * `AuthService.register` only reaches this call on the branch where the address was free, and
   * answers immediately on the branch where it was already taken (a P2002 from the insert). Making
   * the free branch also wait a few hundred milliseconds for `this.email.send` — as `sendLink`
   * does, for `resend`'s good and separate reasons (see there) — turns that difference into a
   * stopwatch that tells an attacker which addresses have accounts here, the exact oracle I16
   * closes everywhere else on this path. The token is still minted and awaited before returning
   * (a DB write, not a network call, and cheap either way), so a person who reloads their inbox a
   * moment later already has a working link; only the wait for Brevo's answer is dropped.
   */
  async sendOnRegistration(userId: string, address: string): Promise<void> {
    const token = await this.tokens.issue(
      userId,
      'EMAIL_VERIFICATION',
      EMAIL_VERIFICATION_TTL_HOURS,
    );

    this.sendWithoutWaiting(this.verificationEmail(address, token));
  }

  /**
   * Sends another link, if this address is one we would send to at all.
   *
   * Answers nothing in every case — unknown address, already verified, over the hourly limit. That
   * is the same reasoning as I16 and as registration in #24: an endpoint that behaves differently
   * for an address that exists is an endpoint anyone can use to list this marketplace's members.
   * The caller turns this into one unconditional 202.
   *
   * ⚠️ Known and accepted: the work differs, so the *timing* differs. A real send takes a few
   * hundred milliseconds that an unknown address does not, which is a weak oracle for someone who
   * measures carefully. Closing it properly means answering before sending, which costs the ability
   * to log a failure against the request that caused it. #28's per-IP limit bounds how fast the
   * measurement can be taken; this is recorded in DECISIONS §17 rather than left to be discovered.
   */
  async resend(rawAddress: string): Promise<void> {
    const address = normaliseEmail(rawAddress);

    const user = await this.prisma.user.findUnique({
      where: { email: address },
      select: { id: true, emailVerifiedAt: true, bannedAt: true },
    });

    if (user === null || user.emailVerifiedAt !== null || user.bannedAt !== null) {
      // No account, nothing left to verify, or an account that is not to be helped back in. The
      // caller says the same thing it says on success.
      return;
    }

    const issuedRecently = await this.tokens.issuedInTheLastHour(user.id, 'EMAIL_VERIFICATION');

    if (issuedRecently >= VERIFICATION_EMAILS_PER_HOUR) {
      // Deliberately silent, to the caller and to the log. Which addresses are being asked for
      // repeatedly is exactly the list this endpoint must not produce.
      this.logger.debug('A verification resend was skipped: the hourly limit was reached.');
      return;
    }

    await this.sendLink(user.id, address);
  }

  /**
   * Spends a link and marks the address verified.
   *
   * Every failure — unknown, expired, already used — comes back as one code. The three are worth
   * distinguishing internally (the service knows which happened) and not worth distinguishing to
   * the caller: what the person does about it is identical, which is to ask for another link, and
   * FRONTEND-NOTES describes one screen for all three.
   *
   * Verifying also spends every other outstanding link for that account, because each one is a
   * live secret sitting in an inbox with nothing left to do.
   */
  async verify(token: string): Promise<void> {
    const result = await this.tokens.consume(token, 'EMAIL_VERIFICATION');

    if (!result.ok) {
      this.logger.debug(`A verification link was rejected: ${result.reason}`);
      throw new AppException('VERIFICATION_LINK_INVALID');
    }

    await this.prisma.user.update({
      where: { id: result.userId },
      data: { emailVerifiedAt: this.clock.now() },
    });

    await this.tokens.spendAllFor(result.userId, 'EMAIL_VERIFICATION');
  }

  /**
   * Fires the send and returns without waiting for Brevo's answer — used only by
   * `sendOnRegistration`, which must not let that round trip show up as a timing difference (see
   * there). The same shape as `PasswordResetService`'s helper of the same name, kept as a second
   * copy rather than shared: the two failure messages name their own flow, and a shared helper
   * would need a parameter for that or lose it.
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
          this.logger.warn(
            `A verification email was not sent (retryable: ${String(result.retryable)}): ${result.reason}`,
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.error(
          `The email provider threw while sending a verification email: ${errorKindForLog(error)}`,
        );
      });
  }
}
