import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.module.js';
import { BrevoEmailSender } from './brevo-email-sender.js';
import { EmailSender } from './email-sender.js';
import { FrontendLinks } from './frontend-links.js';
import { SmtpEmailSender } from './smtp-email-sender.js';

/**
 * Email, for the whole application.
 *
 * `EmailSender` resolves to one implementation here and nowhere else — Brevo's or SMTP's, as
 * `EMAIL_TRANSPORT` says (§107) — which is what makes "no module calls a provider directly" (A4)
 * true by construction rather than by discipline. Tests
 * override the `EmailSender` token with a fake, the same way they override `Clock` — so again there
 * is no `NODE_ENV === 'test'` branch in production wiring.
 */
@Global()
@Module({
  providers: [
    {
      provide: EmailSender,
      inject: [AppConfig],
      useFactory: (config: AppConfig): EmailSender => (config.emailTransport === 'smtp' ? new SmtpEmailSender(config) : new BrevoEmailSender(config)),
    },
    FrontendLinks,
  ],
  exports: [EmailSender, FrontendLinks],
})
export class EmailModule {}
