import { Injectable, Logger } from '@nestjs/common';
import { errorKindForLog } from '../common/errors/error-kind-for-log.js';
import { AppConfig } from '../config/app-config.module.js';
import { EmailMessage, EmailResult, EmailSender } from './email-sender.js';

/** Brevo's transactional endpoint. The only URL in this file, and the only one in the project. */
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * The real sender. Nothing else in the codebase mentions Brevo.
 *
 * Uses `fetch` rather than Brevo's SDK: the request is one POST with a JSON body, and an SDK for
 * that is a dependency to audit and keep current in exchange for saving fifteen lines. Swapping
 * provider means rewriting this file, which is exactly what the interface is for.
 */
@Injectable()
export class BrevoEmailSender extends EmailSender {
  private readonly logger = new Logger(BrevoEmailSender.name);

  constructor(private readonly config: AppConfig) {
    super();
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.config.brevoApiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.config.mailFromAddress, name: this.config.mailFromName },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.body,
        }),
        // Without a timeout this inherits Node's, which is effectively none: a hung provider would
        // hold a request open until the client gave up, and in topic 2 that request is someone
        // trying to register.
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        // Only the kind. Not the address, not the subject, not the body, and above all not the
        // verification link — CLAUDE.md forbids a token reaching a log, and the link *is* the token.
        this.logger.log(`${message.kind}: sent`);
        return { sent: true };
      }

      // Brevo's error body can echo the recipient address back, so it is not read or logged. The
      // status code is enough to decide whether retrying is worthwhile.
      const retryable = response.status >= 500 || response.status === 429;
      this.logger.warn(`${message.kind}: provider responded ${response.status}`);

      return {
        sent: false,
        retryable,
        reason: `brevo responded ${response.status}`,
      };
    } catch (error) {
      // A timeout, DNS failure or dropped connection: all worth retrying. The error's message is
      // not passed on — it is whatever the failing layer chose to write, and callers log `reason`
      // verbatim (§104).
      const kind = errorKindForLog(error);
      this.logger.warn(`${message.kind}: could not reach the provider (${kind})`);

      return { sent: false, retryable: true, reason: `brevo unreachable (${kind})` };
    }
  }
}
