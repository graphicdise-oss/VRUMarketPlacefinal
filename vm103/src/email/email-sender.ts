/**
 * The only way this system sends email (A4).
 *
 * Four places need it — the verification email at registration, password reset (I16), the warnings
 * before a clock runs out, and dispute outcomes. Without one interface, Brevo's client appears in
 * five modules and changing provider means touching all five, while a test has no way to observe
 * what was sent.
 *
 * An abstract class rather than an interface so Nest has a token to inject against. Domain code
 * depends on this and never on Brevo.
 */
export abstract class EmailSender {
  /**
   * Sends one message and says whether it worked.
   *
   * Returns a result rather than throwing, and never swallows a failure. #19 is explicit that the
   * caller must know — but also that *what to do about it* belongs to topic 2, which has real users
   * and can weigh "the account exists but the verification email did not arrive" against failing
   * the registration outright. A thrown exception here would make that decision for them by
   * default, and the default would be the one nobody chose.
   */
  abstract send(message: EmailMessage): Promise<EmailResult>;
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /**
   * Plain text. No HTML, deliberately: the emails this system sends are short and transactional,
   * and an HTML body is a template to maintain, a rendering difference per client, and a place for
   * a link to be disguised. A verification email that reads as plain text is also harder to mistake
   * for phishing.
   */
  readonly body: string;
  /**
   * A name for what this message is, for logging and for the fake in tests. Not sent to the
   * provider.
   *
   * The point is that a log line can say "verification email to 1 recipient: sent" without the
   * subject, the body, or the address appearing anywhere (CLAUDE.md: log only what could be shown
   * in public).
   */
  readonly kind: EmailKind;
}

export const EMAIL_KINDS = [
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'DEADLINE_WARNING',
  'ORDER_STATUS',
  'DISPUTE_OUTCOME',
  'ACCOUNT_ERASURE',
  // §124 (K2): to the first super admin when SUPER_ADMIN_EMAIL has no account yet.
  'SUPER_ADMIN_INVITATION',
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

export type EmailResult =
  | { readonly sent: true }
  | {
      readonly sent: false;
      /**
       * Whether sending again might work.
       *
       * A 5xx from the provider or a timeout is worth retrying; a rejected address is not, and
       * retrying it just sends the same failure again. Topic 2 decides what to do with this.
       */
      readonly retryable: boolean;
      /**
       * For the server log, never for a response body. May name the provider, its status and
       * `errorKindForLog()`'s label — never an error's message, which is text some lower layer
       * wrote and which can carry the recipient (§104). Callers log it verbatim.
       */
      readonly reason: string;
    };

