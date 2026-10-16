import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { errorKindForLog } from '../common/errors/error-kind-for-log.js';
import { AppConfig } from '../config/app-config.module.js';
import { EmailMessage, EmailResult, EmailSender } from './email-sender.js';

/** The same ceiling `BrevoEmailSender` gives its request: a hung mail server must not hold a request open. */
const SMTP_TIMEOUT_MS = 10_000;

/**
 * §107: sending through an SMTP account — a university mail system, where the owner would rather
 * mail not leave for another provider. Chosen by `EMAIL_TRANSPORT=smtp`; `BrevoEmailSender` is the
 * other implementation of the same interface (A4), and nothing outside `EmailModule` knows which.
 *
 * TLS is required, never optional: port 465 speaks TLS from the first byte, any other port must
 * upgrade with STARTTLS before the password goes out, and a server that will not is refused rather
 * than sent the account's password in the clear.
 */
@Injectable()
export class SmtpEmailSender extends EmailSender {
  private readonly logger = new Logger(SmtpEmailSender.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfig) {
    super();
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      await this.transport().sendMail({
        from: { name: this.config.mailFromName, address: this.config.mailFromAddress },
        to: message.to,
        subject: message.subject,
        // Plain text only, as EmailSender requires.
        text: message.body,
      });
      // Only the kind — never the address, subject, body or the link in it (CLAUDE.md).
      this.logger.log(`${message.kind}: sent`);

      return { sent: true };
    } catch (error) {
      // An SMTP reply's own text often quotes the recipient ("550 <someone@…> user unknown"), so
      // only its code is kept. 4xx is the server saying "later"; 5xx — a refused address, a refused
      // login, or a refused STARTTLS from a server offering no TLS — is the same failure every time,
      // and the last two are configuration nobody fixes by sending again.
      const responseCode = smtpResponseCode(error);
      if (responseCode !== null) {
        this.logger.warn(`${message.kind}: mail server responded ${responseCode}`);

        return { sent: false, retryable: responseCode < 500, reason: `smtp responded ${responseCode}` };
      }

      // No reply at all: refused connection, timeout, DNS, a TLS handshake that failed — worth another try.
      const kind = errorKindForLog(error);
      this.logger.warn(`${message.kind}: could not reach the mail server (${kind})`);

      return { sent: false, retryable: true, reason: `smtp unreachable (${kind})` };
    }
  }

  /** What nodemailer is given. Protected so the test can trust its local server's self-signed certificate — the one thing it changes. */
  protected transportOptions(): SMTPTransport.Options {
    const port = this.config.smtpPort;

    return {
      host: this.config.smtpHost,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: this.config.smtpUser, pass: this.config.smtpPassword },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    };
  }

  /** Built on first use, so a deployment on Brevo never constructs one and a boot never dials the server. */
  private transport(): Transporter {
    this.transporter ??= nodemailer.createTransport(this.transportOptions());

    return this.transporter;
  }
}

/** The reply code of a rejection the server actually sent, or null when there was no reply. */
function smtpResponseCode(error: unknown): number | null {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;

  return typeof code === 'number' && code >= 400 && code < 600 ? code : null;
}
