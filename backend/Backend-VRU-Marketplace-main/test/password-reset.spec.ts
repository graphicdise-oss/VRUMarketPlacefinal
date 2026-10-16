import { Logger } from '@nestjs/common';
import type { Agent } from 'supertest';
import {
  PASSWORD_RESET_EMAILS_PER_HOUR,
  PASSWORD_RESET_TTL_HOURS,
} from '../src/auth/auth-policy.js';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../src/auth/cookies.js';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import {
  API,
  GOOD_PASSWORD,
  csrfToken,
  forgotPassword,
  linkTokenFrom,
  login,
  redirectError,
  register,
  registerAndLogin,
  resetPassword,
  setCookie,
  signInWithGoogle,
  verifyEmail,
} from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

const getApp = setupTestApp();

const SOMCHAI = 'somchai@example.test';
const ADMIN = 'superadmin@example.test';
const NEW_PASSWORD = 'a-completely-different-passphrase';

/** The token out of the most recent reset email, the way a person opens their inbox and clicks. */
function resetTokenFromInbox(app: TestApp): string {
  const message = app.email.ofKind('PASSWORD_RESET').at(-1);

  if (message === undefined) {
    throw new Error('No password-reset email was sent.');
  }

  return linkTokenFrom(message.body);
}

/** The common arrangement: an account with a password, and a live reset link for it. */
async function askForALink(app: TestApp, email = SOMCHAI): Promise<string> {
  await register(app.client, email);
  app.email.clear();

  const asked = await forgotPassword(newClient(app), email);

  if (asked.status !== 202) {
    throw new Error(`POST /auth/password/forgot answered ${asked.status}`);
  }

  return resetTokenFromInbox(app);
}

describe('asking for a reset link', () => {
  it('sends one, through EmailSender, with a link to the configured frontend', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    app.email.clear();

    await forgotPassword(app.client, SOMCHAI);

    const sent = app.email.ofKind('PASSWORD_RESET');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(SOMCHAI);

    const link = /https?:\/\/\S+/.exec(sent[0]?.body ?? '')?.[0] ?? '';
    expect(link.startsWith(process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173')).toBe(true);
    expect(link).toContain('/reset-password?token=');
  });

  it('logs a sender that throws by the error’s kind, never by its text (§104)', async () => {
    // The throw path trusts nothing about the error: a rejected-recipient message names the address.
    const app = getApp();
    await register(app.client, SOMCHAI);
    vi.spyOn(app.email, 'send').mockRejectedValue(new Error(`recipient ${SOMCHAI} rejected`));
    const logged: string[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((entry: unknown) => {
      logged.push(String(entry));
    });

    expect((await forgotPassword(newClient(app), SOMCHAI)).status).toBe(202);

    // The send is not awaited by the request, so the log line lands a tick later.
    await vi.waitFor(() => {
      expect(logged.join('\n')).toContain('password-reset email');
    });
    expect(logged.join('\n')).not.toContain(SOMCHAI);
  });

  it('answers exactly the same for an address nobody registered', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    app.email.clear();

    const registered = await forgotPassword(newClient(app), SOMCHAI);
    const invented = await forgotPassword(newClient(app), 'nobody@example.test');

    // Same status, same body. I16: this endpoint must not be usable as a membership list, and
    // "the message differs by one word" is all somebody needs.
    expect(invented.status).toBe(registered.status);
    expect(invented.status).toBe(202);
    expect(invented.text).toBe(registered.text);

    // And nothing was sent to the address that has no account.
    expect(app.email.to('nobody@example.test')).toHaveLength(0);
  });

  it('sends nothing for a banned account, and still answers 202', async () => {
    const app = getApp();

    await registerAndLogin(app.client, SOMCHAI);

    const admin = newClient(app);
    await registerAndLogin(admin, ADMIN);
    // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
    await app.prisma.user.update({ where: { email: ADMIN }, data: { role: 'SUPER_ADMIN' } });
    const somchai = await app.prisma.user.findUniqueOrThrow({
      where: { email: SOMCHAI },
      select: { id: true },
    });
    await admin
      .post(`${API}/admin/users/${somchai.id}/ban`)
      .set(CSRF_HEADER, await csrfToken(admin))
      .send({ reason: 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง' })
      .expect(204);

    app.email.clear();
    const asked = await forgotPassword(newClient(app), SOMCHAI);

    // A reset link is a way back into an account. A banned account is one nobody is to be helped
    // back into — and the answer still cannot say so.
    expect(asked.status).toBe(202);
    expect(app.email.ofKind('PASSWORD_RESET')).toHaveLength(0);
  });

  it('stops after the hourly allowance, without saying so', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    app.email.clear();

    const asked = [];
    for (let attempt = 0; attempt < PASSWORD_RESET_EMAILS_PER_HOUR + 2; attempt += 1) {
      asked.push(await forgotPassword(newClient(app), SOMCHAI));
    }

    expect(asked.every((response) => response.status === 202)).toBe(true);
    expect(app.email.ofKind('PASSWORD_RESET')).toHaveLength(PASSWORD_RESET_EMAILS_PER_HOUR);
  });

  it('allows the next hour a full allowance again — the limit is a window, not a lock', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    app.email.clear();

    for (let attempt = 0; attempt < PASSWORD_RESET_EMAILS_PER_HOUR + 1; attempt += 1) {
      await forgotPassword(newClient(app), SOMCHAI);
    }
    expect(app.email.ofKind('PASSWORD_RESET')).toHaveLength(PASSWORD_RESET_EMAILS_PER_HOUR);

    app.clock.advanceByHours(2);
    await forgotPassword(newClient(app), SOMCHAI);

    expect(app.email.ofKind('PASSWORD_RESET')).toHaveLength(PASSWORD_RESET_EMAILS_PER_HOUR + 1);
  });
});

describe('an account that signs in with Google and has no password', () => {
  it('is told so in the email, and never in the response', async () => {
    const app = getApp();

    await signInWithGoogle(app.client, app.google, SOMCHAI);
    app.email.clear();

    const asked = await forgotPassword(newClient(app), SOMCHAI);

    // Identical to every other outcome. Saying "this account uses Google" here would announce
    // that the address has an account at all, which is the thing I16 spends this whole flow
    // hiding — so the sentence goes where only its owner can read it.
    expect(asked.status).toBe(202);
    expect(asked.text).toBe('');

    const sent = app.email.ofKind('PASSWORD_RESET');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain('Google');
    // And no link, because there is no password to reset.
    expect(sent[0]?.body).not.toContain('/reset-password?token=');
  });

  it('counts that email against the same hourly allowance', async () => {
    const app = getApp();

    await signInWithGoogle(app.client, app.google, SOMCHAI);
    app.email.clear();

    for (let attempt = 0; attempt < PASSWORD_RESET_EMAILS_PER_HOUR + 2; attempt += 1) {
      await forgotPassword(newClient(app), SOMCHAI);
    }

    // A branch that sends without recording would be a branch anyone could ask for without limit,
    // and Brevo's daily quota is shared with every deadline warning the marketplace sends (A4).
    expect(app.email.ofKind('PASSWORD_RESET')).toHaveLength(PASSWORD_RESET_EMAILS_PER_HOUR);
  });
});

describe('using the link', () => {
  it('sets the new password, and the old one stops working', async () => {
    const app = getApp();

    const token = await askForALink(app);

    expect((await resetPassword(newClient(app), token, NEW_PASSWORD)).status).toBe(204);

    expect((await login(newClient(app), SOMCHAI, NEW_PASSWORD)).status).toBe(200);
    expect((await login(newClient(app), SOMCHAI, GOOD_PASSWORD)).status).toBe(401);
  });

  it('works exactly once', async () => {
    const app = getApp();

    const token = await askForALink(app);

    expect((await resetPassword(newClient(app), token, NEW_PASSWORD)).status).toBe(204);

    const second = await resetPassword(newClient(app), token, 'yet-another-passphrase');
    expect(second.status).toBe(400);
    expect((second.body as ErrorBody).code).toBe('RESET_LINK_INVALID');

    // The second attempt changed nothing.
    expect((await login(newClient(app), SOMCHAI, NEW_PASSWORD)).status).toBe(200);
  });

  it('stops working after an hour', async () => {
    const app = getApp();

    const token = await askForALink(app);

    // Seam 2: the clock the app reads, moved from the test. There is deliberately no endpoint
    // that could do this (M5).
    app.clock.advanceByHours(PASSWORD_RESET_TTL_HOURS);
    app.clock.advanceByMinutes(1);

    const late = await resetPassword(newClient(app), token, NEW_PASSWORD);
    expect(late.status).toBe(400);
    expect((late.body as ErrorBody).code).toBe('RESET_LINK_INVALID');

    expect((await login(newClient(app), SOMCHAI, GOOD_PASSWORD)).status).toBe(200);
  });

  it('is still good fifty-nine minutes in', async () => {
    const app = getApp();

    const token = await askForALink(app);

    app.clock.advanceByMinutes(59);

    // The boundary from the other side. Without this, an off-by-one that expired every link
    // immediately would pass the test above.
    expect((await resetPassword(newClient(app), token, NEW_PASSWORD)).status).toBe(204);
  });

  it('answers the same for an invented token as for an expired one', async () => {
    const app = getApp();

    const invented = await resetPassword(newClient(app), 'not-a-token-anybody-issued', NEW_PASSWORD);

    expect(invented.status).toBe(400);
    expect((invented.body as ErrorBody).code).toBe('RESET_LINK_INVALID');
  });

  it('refuses a verification token presented to the reset endpoint', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    const verificationToken = linkTokenFrom(app.email.ofKind('EMAIL_VERIFICATION')[0]?.body ?? '');

    const misused = await resetPassword(newClient(app), verificationToken, NEW_PASSWORD);

    // Both live in one table with a `purpose` column, which is only safe if a token minted for one
    // purpose is invisible to the other. It is reported as unknown rather than as "wrong purpose":
    // presenting one link to the other endpoint should teach the caller nothing.
    expect(misused.status).toBe(400);
    expect((misused.body as ErrorBody).code).toBe('RESET_LINK_INVALID');
  });

  it('spends the other outstanding links as well', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    app.email.clear();

    await forgotPassword(newClient(app), SOMCHAI);
    const first = resetTokenFromInbox(app);
    await forgotPassword(newClient(app), SOMCHAI);
    const second = resetTokenFromInbox(app);

    expect((await resetPassword(newClient(app), second, NEW_PASSWORD)).status).toBe(204);

    // The older email is still in that inbox, and until this it was a live temporary password.
    expect((await resetPassword(newClient(app), first, 'a-third-passphrase')).status).toBe(400);
  });
});

describe('a completed reset ends every session (I16)', () => {
  /** Signs the same person in on two devices, and returns both. */
  async function signedInOnTwoDevices(app: TestApp): Promise<{ laptop: Agent; phone: Agent }> {
    const laptop = app.client;
    await registerAndLogin(laptop, SOMCHAI);

    const phone = newClient(app);
    const signedIn = await login(phone, SOMCHAI);
    expect(signedIn.status).toBe(200);

    return { laptop, phone };
  }

  it('signs the other device out — which is the whole point of the feature', async () => {
    const app = getApp();
    const { laptop, phone } = await signedInOnTwoDevices(app);

    expect((await phone.get(`${API}/auth/me`)).status).toBe(200);

    app.email.clear();
    await forgotPassword(newClient(app), SOMCHAI);
    await resetPassword(newClient(app), resetTokenFromInbox(app), NEW_PASSWORD);

    // A good share of the people who reach this flow are here because somebody else is already
    // inside. A new password that left the intruder's session alive would be decorative.
    expect((await phone.get(`${API}/auth/me`)).status).toBe(401);
    expect((await laptop.get(`${API}/auth/me`)).status).toBe(401);
  });

  it('leaves the other device unable to refresh its way back in', async () => {
    const app = getApp();
    const { phone } = await signedInOnTwoDevices(app);

    app.email.clear();
    await forgotPassword(newClient(app), SOMCHAI);
    await resetPassword(newClient(app), resetTokenFromInbox(app), NEW_PASSWORD);

    // The access token expiring is not enough: the refresh cookie is worth thirty days, so a
    // reset that only invalidated access tokens would put the intruder back in on the next call.
    const refreshed = await phone
      .post(`${API}/auth/refresh`)
      .set(CSRF_HEADER, await csrfToken(phone));

    expect(refreshed.status).toBe(401);
    expect(setCookie(refreshed, ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(setCookie(refreshed, REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });

  it('does not sign in the browser that did the reset either', async () => {
    const app = getApp();

    const token = await askForALink(app);
    const response = await resetPassword(newClient(app), token, NEW_PASSWORD);

    // The link is usually opened on a different device from the one that asked, so there is
    // nobody here to sign in. Returning cookies would also mean a working session for whoever
    // happened to be holding the link.
    expect(setCookie(response, ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(setCookie(response, REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });
});

describe('a reset proves the address, so it closes the squatting case in N15', () => {
  it('marks an unverified address verified', async () => {
    const app = getApp();

    const token = await askForALink(app);
    await resetPassword(newClient(app), token, NEW_PASSWORD);

    const signedIn = await login(newClient(app), SOMCHAI, NEW_PASSWORD);
    expect((signedIn.body as { emailVerified?: boolean }).emailVerified).toBe(true);
  });

  it('takes an address back from a squatter, and lets its owner connect Google afterwards', async () => {
    const app = getApp();

    // The squatter registers an address they cannot read and signs in with the password they set.
    const squatter = newClient(app);
    await register(squatter, SOMCHAI);
    await login(squatter, SOMCHAI);

    // The real owner does what anybody would: presses "forgot password", and reads the email.
    app.email.clear();
    await forgotPassword(newClient(app), SOMCHAI);
    await resetPassword(newClient(app), resetTokenFromInbox(app), NEW_PASSWORD);
    expect((await squatter.get(`${API}/auth/me`)).status).toBe(401);

    // §101: the account now has a proven address and a password only its owner knows — Google is
    // connected from a session signed in with that password, and not by Google's word alone.
    const owner = newClient(app);
    expect((await login(owner, SOMCHAI, NEW_PASSWORD)).status).toBe(200);
    expect(redirectError(await signInWithGoogle(owner, app.google, SOMCHAI))).toBeNull();
    expect((await owner.get(`${API}/auth/me`)).status).toBe(200);
  });

  it('does not need the address to be verified first', async () => {
    const app = getApp();

    // Requiring verification before a reset would close the escape hatch above and strand exactly
    // the people it exists for.
    await register(app.client, SOMCHAI);
    app.email.clear();

    await forgotPassword(newClient(app), SOMCHAI);
    expect(app.email.ofKind('PASSWORD_RESET')).toHaveLength(1);
  });

  it('still lets a verified address reset normally', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    await verifyEmail(
      app.client,
      linkTokenFrom(app.email.ofKind('EMAIL_VERIFICATION')[0]?.body ?? ''),
    );
    app.email.clear();

    await forgotPassword(newClient(app), SOMCHAI);
    expect((await resetPassword(newClient(app), resetTokenFromInbox(app), NEW_PASSWORD)).status).toBe(
      204,
    );
  });
});

describe('what the endpoints refuse outright', () => {
  it('rejects a new password that is too short, before touching anything', async () => {
    const app = getApp();

    const token = await askForALink(app);

    const tooShort = await resetPassword(newClient(app), token, 'short');
    expect(tooShort.status).toBe(400);
    expect((tooShort.body as ErrorBody).code).toBe('VALIDATION_FAILED');

    // And the link is still good, because nothing was spent.
    expect((await resetPassword(newClient(app), token, NEW_PASSWORD)).status).toBe(204);
  });

  it('needs a CSRF token like every other write', async () => {
    const app = getApp();

    const refused = await app.client
      .post(`${API}/auth/password/forgot`)
      .send({ email: SOMCHAI });

    // No exemption list (N8). The most common cause of this in real life is benign, which is why
    // it has its own code.
    expect(refused.status).toBe(403);
    expect((refused.body as ErrorBody).code).toBe('CSRF_FAILED');
  });
});
