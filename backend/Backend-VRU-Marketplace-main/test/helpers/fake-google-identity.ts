import {
  GoogleAccount,
  GoogleExchangeResult,
  GoogleIdentity,
} from '../../src/auth/google-identity.js';

/**
 * Google, as far as the test suite is concerned.
 *
 * Stands in for the same reason `FakeEmailSender` does, and M5 treats it the same way: it is an
 * outbound adapter to somebody else's server, not a way into this system. The tests still arrive
 * through `GET /api/v1/auth/google/callback` exactly as a browser does, carrying a real `state`
 * cookie, and every rule about linking accounts is decided on that path by the real service.
 *
 * The alternative would be a suite that cannot run without a browser consenting on
 * accounts.google.com — which means, in practice, a flow nobody tests at all.
 */
export class FakeGoogleIdentity extends GoogleIdentity {
  /** Every `state` this has been asked to build a URL for, in order. */
  readonly statesIssued: string[] = [];

  private readonly accountsByCode = new Map<string, GoogleAccount>();

  /**
   * Arrange: whoever comes back with this code is this Google account.
   *
   * `emailVerified` defaults to true because that is the ordinary case; the test for the
   * unverified one says so explicitly, which is how it reads as being about that rule.
   */
  willAccept(
    code: string,
    account: { email: string; emailVerified?: boolean; subject?: string },
  ): void {
    this.accountsByCode.set(code, {
      email: account.email.trim().toLowerCase(),
      emailVerified: account.emailVerified ?? true,
      subject: account.subject ?? `google-subject-for-${account.email}`,
    });
  }

  authorisationUrl(state: string): string {
    this.statesIssued.push(state);

    const url = new URL('https://accounts.google.test/o/oauth2/v2/auth');
    url.searchParams.set('state', state);

    return url.toString();
  }

  exchangeCode(code: string): Promise<GoogleExchangeResult> {
    const account = this.accountsByCode.get(code);

    if (account === undefined) {
      // What an expired, reused or invented code looks like coming back from Google.
      return Promise.resolve({ ok: false, reason: 'fake: no such code' });
    }

    // Spent. A real authorisation code works exactly once, and a fake that let one be replayed
    // would hide a flow that depended on replaying it.
    this.accountsByCode.delete(code);

    return Promise.resolve({ ok: true, account });
  }

  /** Called by `setupTestApp()` before each test, so nothing carries over. */
  clear(): void {
    this.statesIssued.length = 0;
    this.accountsByCode.clear();
  }
}
