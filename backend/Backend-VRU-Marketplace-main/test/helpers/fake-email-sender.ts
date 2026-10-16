import { EmailKind, EmailMessage, EmailResult, EmailSender } from '../../src/email/email-sender.js';

/**
 * The EmailSender tests use. M5 says explicitly that this does not count as a third seam.
 *
 * It exists so a test can assert what a flow actually sent — which is the only way to check, for
 * instance, that the "this account signs in with Google" message goes in the email and not in the
 * response body (the correction recorded against #27), or that asking for a reset twice does not
 * send two emails.
 */
export class FakeEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];

  /** Set to make the next sends fail, for testing what a caller does about it. */
  private failure: Extract<EmailResult, { sent: false }> | null = null;

  /** Set by hangNextSend(); resolved by resolvePendingSend(). See both for what they are for. */
  private pendingSend: ((result: EmailResult) => void) | null = null;
  private hangNext = false;

  send(message: EmailMessage): Promise<EmailResult> {
    // Recorded even when failing (or hanging): a caller that retries should be visible as two
    // entries, and a hung send is still a send a test can assert was attempted.
    this.sent.push(message);

    if (this.hangNext) {
      this.hangNext = false;

      return new Promise((resolve) => {
        this.pendingSend = resolve;
      });
    }

    return Promise.resolve(this.failure ?? { sent: true });
  }

  /**
   * Makes the next `send` return a promise that never settles on its own — for proving that a
   * caller does not `await` it. If the caller does, the calling test itself hangs until Vitest's
   * `testTimeout`, which is the point: there is no timing measurement to make flaky, only a
   * promise that is either awaited (test times out) or is not (test finishes normally).
   *
   * Added for /code-review of #24/#25 (DECISIONS.md §73), which is also the first caller.
   */
  hangNextSend(): void {
    this.hangNext = true;
  }

  /** Lets a send hung by hangNextSend() finish. A no-op if nothing is pending. */
  resolvePendingSend(): void {
    this.pendingSend?.({ sent: true });
    this.pendingSend = null;
  }

  /** Every message sent to one address, in order. */
  to(address: string): EmailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }

  /** Every message of one kind. */
  ofKind(kind: EmailKind): EmailMessage[] {
    return this.sent.filter((message) => message.kind === kind);
  }

  /** The most recent message, for the common case of asserting on what just happened. */
  last(): EmailMessage | undefined {
    return this.sent.at(-1);
  }

  failNextSends(reason = 'fake failure', retryable = true): void {
    this.failure = { sent: false, retryable, reason };
  }

  succeedAgain(): void {
    this.failure = null;
  }

  /** Called by `setupTestApp()` before each test, so counts never carry over. */
  clear(): void {
    this.sent.length = 0;
    this.failure = null;
    this.resolvePendingSend();
    this.hangNext = false;
  }
}
