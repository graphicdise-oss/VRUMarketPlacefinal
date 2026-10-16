import { Logger } from '@nestjs/common';
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  VERIFICATION_EMAILS_PER_HOUR,
} from '../src/auth/auth-policy.js';
import { MeDto } from '../src/auth/dto/me.dto.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { EmailMessage } from '../src/email/email-sender.js';
import {
  API,
  GOOD_PASSWORD,
  csrfToken,
  linkTokenFrom,
  register,
  registerAndLogin,
} from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';

const getApp = setupTestApp();

const SOMCHAI = 'somchai@example.test';

/**
 * Pulls the link out of the most recent verification email, the way a person opens their inbox.
 *
 * The token is read from the email rather than from the database on purpose: that round trip is
 * what proves #19's EmailSender is wired to something real. A test that read the row would pass
 * even if no email were ever sent.
 */
function tokenFromLatestEmail(app: TestApp): string {
  const message = app.email.ofKind('EMAIL_VERIFICATION').at(-1);

  if (message === undefined) {
    throw new Error('No verification email was sent.');
  }

  return tokenFrom(message);
}

function tokenFrom(message: EmailMessage): string {
  // The shared helper, not a copy of it: #27 needed the same "open the inbox and click" step for
  // reset links, and two implementations of reading a token out of an email is two places for the
  // link format to drift from what the emails actually contain.
  return linkTokenFrom(message.body);
}

describe('the email that registration sends', () => {
  it('goes out through EmailSender, to the address that registered', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    // #19 shipped the interface and the fake with nothing calling either. This is the first
    // assertion in the project that an email is actually sent by anything.
    const sent = app.email.ofKind('EMAIL_VERIFICATION');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(SOMCHAI);
    expect(sent[0]?.subject).toContain('ยืนยันอีเมล');
  });

  it('builds the link from the configured frontend URL, not a hardcoded domain', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    const link = /https?:\/\/\S+/.exec(app.email.last()?.body ?? '')?.[0] ?? '';

    // The real domain is still undecided (#20), so the base has to come from configuration.
    expect(link.startsWith(process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173')).toBe(true);
    expect(link).toContain('/verify-email?token=');
  });

  it('does not email an address that already has an account', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    app.email.clear();

    await register(app.client, SOMCHAI);

    // The second registration answers 202 like the first (#24), and quietly does nothing. Sending
    // here would tell the address's owner that somebody is trying to register as them — a message
    // nobody asked this system to send, and a way to confirm that an address is registered.
    expect(app.email.sent).toEqual([]);
  });

  it('still creates the account when the mail provider is down', async () => {
    const app = getApp();

    app.email.failNextSends('provider unavailable');

    await register(app.client, SOMCHAI);

    // The row exists, so registering again would do nothing and say nothing — failing the request
    // would stand the person in a place with no way forward. They can press resend instead.
    app.email.succeedAgain();
    await app.client
      .post(`${API}/auth/resend-verification`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ email: SOMCHAI })
      .expect(202);

    expect(app.email.ofKind('EMAIL_VERIFICATION').at(-1)?.to).toBe(SOMCHAI);
  });

  it('logs a sender that throws by the error’s kind, never by its text (§104)', async () => {
    // The throw path trusts nothing about the error: a rejected-recipient message names the address.
    const app = getApp();
    vi.spyOn(app.email, 'send').mockRejectedValue(new Error(`recipient ${SOMCHAI} rejected`));
    const logged: string[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((entry: unknown) => {
      logged.push(String(entry));
    });

    await register(app.client, SOMCHAI);

    // The send is not awaited by the request (§73), so the log line lands a tick later.
    await vi.waitFor(() => {
      expect(logged.join('\n')).toContain('verification email');
    });
    expect(logged.join('\n')).not.toContain(SOMCHAI);
  });

  it('answers a resend with 202 when the sender throws, and logs only the error’s kind (§104 review)', async () => {
    // Resend awaits the send, so a throw used to escape to the exception filter: the stack (message
    // and all) went to the log, and the answer became 500 — for an address with an unverified
    // account only, which tells the caller the account exists (I16).
    const app = getApp();
    await register(app.client, SOMCHAI);
    vi.spyOn(app.email, 'send').mockRejectedValue(new Error(`recipient ${SOMCHAI} rejected`));
    const logged: string[] = [];
    for (const level of ['error', 'warn'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((entry: unknown, ...rest: unknown[]) => {
        logged.push([entry, ...rest].map(String).join(' '));
      });
    }

    await app.client
      .post(`${API}/auth/resend-verification`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ email: SOMCHAI })
      .expect(202);

    expect(logged.join('\n')).toContain('verification email');
    expect(logged.join('\n')).not.toContain(SOMCHAI);
  });

  it('answers a fresh address without waiting for the mail provider (§73)', async () => {
    // Found in /code-review of #24/#25 (DECISIONS.md §73): registering a *taken* address answers
    // as soon as the duplicate-key error comes back from the insert, but a *free* one used to wait
    // for the full round trip to Brevo first — a stopwatch difference that told an attacker which
    // addresses have accounts here, the exact oracle I16 closes everywhere else on this path.
    //
    // hangNextSend() makes the email provider's answer never arrive on its own. If this endpoint
    // still awaited it, the request below would hang until Vitest's testTimeout and this test
    // would fail on a timeout — there is nothing to measure and nothing to be flaky.
    const app = getApp();

    app.email.hangNextSend();

    await register(app.client, SOMCHAI);

    // The hung send was still attempted — proving the fix is "do not wait", not "do not send".
    expect(app.email.ofKind('EMAIL_VERIFICATION')).toHaveLength(1);

    app.email.resolvePendingSend();
  });
});

describe('following the link', () => {
  it('verifies the address, and /me says so', async () => {
    const app = getApp();

    await registerAndLogin(app.client, SOMCHAI);
    expect(((await app.client.get(`${API}/auth/me`)).body as MeDto).emailVerified).toBe(false);

    await app.client
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ token: tokenFromLatestEmail(app) })
      .expect(204);

    expect(((await app.client.get(`${API}/auth/me`)).body as MeDto).emailVerified).toBe(true);
  });

  it('works from a browser that never signed in', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    const token = tokenFromLatestEmail(app);

    // The common case: the link is opened in the phone's mail app, which has no session. The
    // endpoint is public for exactly this reason.
    const phone = newClient(app);
    await phone
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(phone))
      .send({ token })
      .expect(204);
  });

  it('refuses the same link a second time', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    const token = tokenFromLatestEmail(app);

    const verify = async () =>
      app.client
        .post(`${API}/auth/verify-email`)
        .set(CSRF_HEADER, await csrfToken(app.client))
        .send({ token });

    expect((await verify()).status).toBe(204);

    const second = await verify();
    expect(second.status).toBe(400);
    expect((second.body as ErrorBody).code).toBe('VERIFICATION_LINK_INVALID');
  });

  it('refuses a link that is a day old', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    const token = tokenFromLatestEmail(app);

    app.clock.advanceByHours(EMAIL_VERIFICATION_TTL_HOURS + 1);

    const response = await app.client
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ token });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).code).toBe('VERIFICATION_LINK_INVALID');
  });

  it('still works one hour before it expires', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    const token = tokenFromLatestEmail(app);

    app.clock.advanceByHours(EMAIL_VERIFICATION_TTL_HOURS - 1);

    await app.client
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ token })
      .expect(204);
  });

  it('answers an invented link the same way as an expired one', async () => {
    const app = getApp();

    const response = await app.client
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ token: 'a-token-nobody-ever-issued' });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).code).toBe('VERIFICATION_LINK_INVALID');
  });

  it('kills the older links once one of them has been used', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    const first = tokenFromLatestEmail(app);

    await app.client
      .post(`${API}/auth/resend-verification`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ email: SOMCHAI })
      .expect(202);
    const second = tokenFromLatestEmail(app);
    expect(second).not.toBe(first);

    await app.client
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ token: second })
      .expect(204);

    // The first email is still sitting in that inbox. Once the address is verified its link has
    // nothing left to do, and a live secret with nothing to do is one worth spending.
    const stale = await app.client
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ token: first });

    expect(stale.status).toBe(400);
  });
});

describe('asking for another link', () => {
  it('sends one that works', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    app.email.clear();

    await app.client
      .post(`${API}/auth/resend-verification`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ email: SOMCHAI })
      .expect(202);

    await app.client
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ token: tokenFromLatestEmail(app) })
      .expect(204);
  });

  it('answers identically for an address nobody registered', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    app.email.clear();

    const resend = async (email: string) =>
      app.client
        .post(`${API}/auth/resend-verification`)
        .set(CSRF_HEADER, await csrfToken(app.client))
        .send({ email });

    const registered = await resend(SOMCHAI);
    const invented = await resend('nobody@example.test');

    // Same status, same body. I16: this endpoint must not become a way to find out who is here.
    expect(invented.status).toBe(registered.status);
    expect(invented.body).toEqual(registered.body);
    // And nothing was sent to the address that does not exist.
    expect(app.email.to('nobody@example.test')).toEqual([]);
  });

  it('answers identically for an address that is already verified, and sends nothing', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    await app.client
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ token: tokenFromLatestEmail(app) })
      .expect(204);
    app.email.clear();

    await app.client
      .post(`${API}/auth/resend-verification`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ email: SOMCHAI })
      .expect(202);

    expect(app.email.sent).toEqual([]);
  });

  it('stops after three an hour, without saying so', async () => {
    const app = getApp();

    // Registration sends one, and that one counts — so two more are allowed this hour. The
    // reading of I17 behind that is written out at VERIFICATION_EMAILS_PER_HOUR.
    await register(app.client, SOMCHAI);

    const resend = async () =>
      app.client
        .post(`${API}/auth/resend-verification`)
        .set(CSRF_HEADER, await csrfToken(app.client))
        .send({ email: SOMCHAI });

    for (let attempt = 0; attempt < VERIFICATION_EMAILS_PER_HOUR + 2; attempt += 1) {
      const response = await resend();
      // Every answer is the same, including the ones that sent nothing. Brevo's quota is shared
      // by the whole marketplace (I17), and the limit protects it — it is not a message to show.
      expect(response.status).toBe(202);
    }

    expect(app.email.ofKind('EMAIL_VERIFICATION')).toHaveLength(VERIFICATION_EMAILS_PER_HOUR);
  });

  it('allows another three once the hour has passed', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    const resend = async () =>
      app.client
        .post(`${API}/auth/resend-verification`)
        .set(CSRF_HEADER, await csrfToken(app.client))
        .send({ email: SOMCHAI })
        .expect(202);

    // Spend the hour's allowance, then ask twice more into the wall.
    for (let attempt = 0; attempt < VERIFICATION_EMAILS_PER_HOUR + 1; attempt += 1) {
      await resend();
    }
    expect(app.email.sent).toHaveLength(VERIFICATION_EMAILS_PER_HOUR);

    app.clock.advanceByHours(1);
    await resend();

    // A limit that never lifts is a locked account, which is the failure mode I17 rejects for
    // login attempts and which applies here for the same reason.
    expect(app.email.sent).toHaveLength(VERIFICATION_EMAILS_PER_HOUR + 1);
  });

  it('needs a CSRF token like every other request that changes data', async () => {
    const app = getApp();

    const response = await app.client
      .post(`${API}/auth/resend-verification`)
      .send({ email: SOMCHAI });

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('CSRF_FAILED');
  });
});

describe('what an unverified account can still do', () => {
  it('browses and reads its own profile (B0.1)', async () => {
    const app = getApp();

    await registerAndLogin(app.client, SOMCHAI);

    // Viewing and searching never require a verified address — only ordering and opening a shop
    // will, and both arrive later. An unverified account is a usable account until then.
    await app.client.get(`${API}/health`).expect(200);
    await app.client.get(`${API}/auth/me`).expect(200);
  });
});

describe('the sweep clears out spent links', () => {
  it('is registered with the one sweep point', () => {
    const { sweep } = getApp();

    expect(sweep.registeredTaskNames()).toContain('verificationTokens.removeExpired');
  });

  it('removes links past their expiry and keeps the live ones', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    app.clock.advanceByHours(EMAIL_VERIFICATION_TTL_HOURS + 1);

    // A second account registers after the first link has expired, so one row should survive.
    await register(newClient(app), 'malee@example.test');
    expect(await app.prisma.verificationToken.count()).toBe(2);

    await app.sweep.run();

    const remaining = await app.prisma.verificationToken.findMany({
      select: { user: { select: { email: true } } },
    });
    expect(remaining).toEqual([{ user: { email: 'malee@example.test' } }]);
  });
});

describe('the password is still never in an email', () => {
  it('sends nothing that contains it', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI, GOOD_PASSWORD);

    for (const message of app.email.sent) {
      expect(message.body).not.toContain(GOOD_PASSWORD);
    }
  });
});
