import type { Agent } from 'supertest';
import { AccountMarkerService } from '../src/auth/account-marker.service.js';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../src/auth/cookies.js';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { MeDto } from '../src/auth/dto/me.dto.js';
import { OAUTH_STATE_COOKIE } from '../src/auth/oauth-state.js';
import { newId } from '../src/common/id.js';
import {
  API,
  GOOD_PASSWORD,
  csrfToken,
  linkTokenFrom,
  login,
  redirectError,
  redirectTarget,
  register,
  registerAndLogin,
  setCookie,
  setCookieAttributes,
  signInWithGoogle,
  verifyEmail,
} from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

const getApp = setupTestApp();

const SOMCHAI = 'somchai@example.test';
const ADMIN = 'superadmin@example.test';

/** Registers, then clicks the link that arrived — the ordinary way an address becomes verified. */
async function registerAndVerify(app: TestApp, client: Agent, email: string): Promise<void> {
  await register(client, email);

  const message = app.email.ofKind('EMAIL_VERIFICATION').at(-1);

  if (message === undefined) {
    throw new Error(`No verification email was sent to ${email}.`);
  }

  const verified = await verifyEmail(client, linkTokenFrom(message.body));

  if (verified.status !== 204) {
    throw new Error(`Could not verify ${email}: ${verified.status}`);
  }
}

async function userIdOf(app: TestApp, email: string): Promise<string> {
  const user = await app.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  return user.id;
}

/** Who the app says this client is. Through HTTP, like everything a test asserts on. */
async function meOn(client: Agent): Promise<MeDto> {
  const response = await client.get(`${API}/auth/me`);

  if (response.status !== 200) {
    throw new Error(`GET /auth/me answered ${response.status}`);
  }

  return response.body as MeDto;
}

describe('starting a Google sign-in', () => {
  it('redirects to Google and hands the browser a state cookie to come back with', async () => {
    const app = getApp();

    const start = await app.client.get(`${API}/auth/google`);

    expect(start.status).toBe(302);
    const state = redirectTarget(start).searchParams.get('state');
    expect(state).not.toBeNull();

    // The same value in the cookie and in the URL is the whole mechanism: an attacker can forge
    // the second but cannot write the first onto this browser.
    expect(setCookie(start, OAUTH_STATE_COOKIE)).toBe(state);

    const attributes = setCookieAttributes(start, OAUTH_STATE_COOKIE);
    expect(attributes).toContain('httponly');
    // Lax and not Strict: the journey back from accounts.google.com is cross-site by definition,
    // and Strict would withhold the cookie on exactly that hop, for everybody, every time.
    expect(attributes).toContain('samesite=lax');
  });

  it('is reachable without being signed in', async () => {
    const app = getApp();

    // `@Public()`, and it has to be: nobody signing in has a session yet. The point of asserting
    // it is that the global guard is default-deny, so this route is one decorator away from 401.
    expect((await app.client.get(`${API}/auth/google`)).status).toBe(302);
  });
});

describe('signing in with Google for the first time', () => {
  it('creates an account, sets the same two cookies as a password login, and returns no token', async () => {
    const app = getApp();

    const response = await signInWithGoogle(app.client, app.google, SOMCHAI);

    expect(response.status).toBe(302);
    expect(redirectError(response)).toBeNull();

    // B3: the same cookie pair the rest of the system already understands — not a second
    // mechanism with its own lifetime, its own revocation and its own way of being forgotten.
    expect(setCookie(response, ACCESS_TOKEN_COOKIE)).toBeDefined();
    expect(setCookie(response, REFRESH_TOKEN_COOKIE)).toBeDefined();

    // And nothing in the body. A redirect has none, which is the point: there is no shape of
    // response here that a token could be added to by accident later.
    expect(response.text).not.toContain(setCookie(response, ACCESS_TOKEN_COOKIE) ?? 'impossible');

    const me = await meOn(app.client);
    expect(me.email).toBe(SOMCHAI);
  });

  it('treats the address as verified, because Google verified it', async () => {
    const app = getApp();

    await signInWithGoogle(app.client, app.google, SOMCHAI);

    // Sending our own verification email to an address Google has just verified would ask the
    // person to prove the same thing twice — and leave them unable to order until they did (K4).
    expect((await meOn(app.client)).emailVerified).toBe(true);
    expect(app.email.ofKind('EMAIL_VERIFICATION')).toHaveLength(0);
  });

  it('creates an account with no password, so a password login for it cannot work', async () => {
    const app = getApp();

    await signInWithGoogle(app.client, app.google, SOMCHAI);

    // The distinction #27 reads to answer "this account signs in with Google" — and the reason
    // `passwordHash` was nullable from the very first migration.
    const attempt = await login(newClient(app), SOMCHAI, GOOD_PASSWORD);
    expect(attempt.status).toBe(401);
  });

  it('lands the browser back on the frontend, not on an API page', async () => {
    const app = getApp();

    const response = await signInWithGoogle(app.client, app.google, SOMCHAI);

    const target = redirectTarget(response);
    expect(target.origin).toBe(new URL(process.env.FRONTEND_BASE_URL ?? '').origin);
    expect(target.pathname).toContain('/auth/google/complete');
  });
});

describe('what Google says about the address is not taken on trust', () => {
  it('refuses when Google has not verified the address, and creates nothing', async () => {
    const app = getApp();

    const response = await signInWithGoogle(app.client, app.google, SOMCHAI, {
      emailVerified: false,
    });

    expect(redirectError(response)).toBe('GOOGLE_EMAIL_UNVERIFIED');
    expect(setCookie(response, ACCESS_TOKEN_COOKIE)).toBeUndefined();
    // An unverified claim must not even leave a row behind: an account created here would be an
    // account somebody else could later take over by verifying the address.
    expect(await app.prisma.user.count()).toBe(0);
  });
});

describe('linking a Google sign-in to an account that already exists', () => {
  it('gives the same account — not a second one — when the address is verified here too', async () => {
    const app = getApp();
    const somchai = app.client;

    await registerAndVerify(app, somchai, SOMCHAI);
    const registeredId = await userIdOf(app, SOMCHAI);

    // §101: an account with a password is connected to Google by someone who has proven that
    // password — here, by being signed in with it.
    expect((await login(somchai, SOMCHAI)).status).toBe(200);
    const response = await signInWithGoogle(somchai, app.google, SOMCHAI);

    expect(redirectError(response)).toBeNull();
    expect((await meOn(somchai)).id).toBe(registeredId);
    // The duplicate account user story 4 of #3 says must not happen.
    expect(await app.prisma.user.count()).toBe(1);
  });

  it('an account whose address was never verified goes to Google’s proven owner — the takeover case', async () => {
    const app = getApp();

    // The attack: somebody registers an address they cannot read and sets a password they know.
    // §101: until the address is proven the account belongs to nobody, so Google's proof of it
    // wins the account — and the password nobody proved is what goes (google-account-takeover.spec).
    await register(app.client, SOMCHAI, 'the-squatter-knows-this-one');

    const owner = newClient(app);
    const response = await signInWithGoogle(owner, app.google, SOMCHAI);

    expect(redirectError(response)).toBeNull();
    expect((await login(newClient(app), SOMCHAI, 'the-squatter-knows-this-one')).status).toBe(401);
  });

  it('retires the unproven account and gives the address a fresh, verified one with no password', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    const squattedId = await userIdOf(app, SOMCHAI);
    await signInWithGoogle(newClient(app), app.google, SOMCHAI, {});

    // What the rows hold afterwards — no endpoint shows whether an account has a password, or
    // anything at all about an erased one.
    const user = await app.prisma.user.findUniqueOrThrow({ where: { email: SOMCHAI } });
    const retired = await app.prisma.user.findUniqueOrThrow({ where: { id: squattedId } });

    expect(user.id).not.toBe(squattedId);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordHash).toBeNull();
    expect(retired.erasedAt).not.toBeNull();
  });

  it('lets somebody who has both ways in use either one', async () => {
    const app = getApp();

    await registerAndVerify(app, app.client, SOMCHAI);
    const expectedId = await userIdOf(app, SOMCHAI);

    // §101: connected once, from a session signed in with the password.
    expect((await login(app.client, SOMCHAI)).status).toBe(200);
    expect(redirectError(await signInWithGoogle(app.client, app.google, SOMCHAI))).toBeNull();

    const withGoogle = newClient(app);
    await signInWithGoogle(withGoogle, app.google, SOMCHAI);
    expect((await meOn(withGoogle)).id).toBe(expectedId);

    const withPassword = newClient(app);
    expect((await login(withPassword, SOMCHAI)).status).toBe(200);
    expect((await meOn(withPassword)).id).toBe(expectedId);

    expect(await app.prisma.user.count()).toBe(1);
  });

  it('refuses a banned account, and says so', async () => {
    const app = getApp();

    await registerAndVerify(app, app.client, SOMCHAI);

    const admin = newClient(app);
    await registerAndLogin(admin, ADMIN);
    // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
    await app.prisma.user.update({ where: { email: ADMIN }, data: { role: 'SUPER_ADMIN' } });
    const banned = await admin
      .post(`${API}/admin/users/${await userIdOf(app, SOMCHAI)}/ban`)
      .set(CSRF_HEADER, await csrfToken(admin))
      .send({ reason: 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง' });
    expect(banned.status).toBe(204);

    // Invariant 7 through the other door: a ban that only closed the password form would be a ban
    // anyone could step around by pressing "sign in with Google".
    const response = await signInWithGoogle(newClient(app), app.google, SOMCHAI);
    expect(redirectError(response)).toBe('ACCOUNT_BANNED');
    expect(setCookie(response, ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  it('refuses an address whose previous account was banned and erased (K16)', async () => {
    const app = getApp();

    await app.prisma.deletedAccountMarker.create({
      data: {
        id: newId(),
        emailHmac: app.app.get(AccountMarkerService).hash(SOMCHAI),
        deletedAt: app.clock.now(),
        wasBanned: true,
        disputeLostCount: 0,
      },
    });

    const response = await signInWithGoogle(app.client, app.google, SOMCHAI);

    // K16 enforced on one of two entrances is K16 not enforced.
    expect(redirectError(response)).toBe('GOOGLE_SIGN_IN_FAILED');
    expect(await app.prisma.user.count()).toBe(0);
  });
});

describe('the callback cannot be driven by somebody else', () => {
  it('refuses a state that does not match the cookie', async () => {
    const app = getApp();

    await app.client.get(`${API}/auth/google`);
    app.google.willAccept('a-code', { email: SOMCHAI });

    const response = await app.client
      .get(`${API}/auth/google/callback`)
      .query({ code: 'a-code', state: 'a-state-this-browser-was-never-given' });

    expect(redirectError(response)).toBe('GOOGLE_SIGN_IN_FAILED');
    expect(setCookie(response, ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(await app.prisma.user.count()).toBe(0);
  });

  it('refuses a callback from a browser that never started a sign-in', async () => {
    const app = getApp();

    // The attack this stops: a forged link that completes the attacker's Google sign-in inside the
    // victim's browser, leaving them signed in as somebody else without noticing.
    const stranger = newClient(app);
    app.google.willAccept('a-code', { email: SOMCHAI });

    const response = await stranger
      .get(`${API}/auth/google/callback`)
      .query({ code: 'a-code', state: 'anything' });

    expect(redirectError(response)).toBe('GOOGLE_SIGN_IN_FAILED');
    expect(await app.prisma.user.count()).toBe(0);
  });

  it('refuses a code that has already been spent', async () => {
    const app = getApp();

    const first = await signInWithGoogle(app.client, app.google, SOMCHAI, { code: 'one-use-only' });
    expect(redirectError(first)).toBeNull();

    // A second sign-in with the same code: the state is fresh, so this fails on the code alone.
    const replay = await app.client.get(`${API}/auth/google`);
    const state = redirectTarget(replay).searchParams.get('state');

    const second = await app.client
      .get(`${API}/auth/google/callback`)
      .query({ code: 'one-use-only', state });

    expect(redirectError(second)).toBe('GOOGLE_SIGN_IN_FAILED');
  });

  it('refuses when Google sends an error back instead of a code', async () => {
    const app = getApp();

    const start = await app.client.get(`${API}/auth/google`);
    const state = redirectTarget(start).searchParams.get('state');

    // What pressing "cancel" on the consent screen looks like.
    const response = await app.client
      .get(`${API}/auth/google/callback`)
      .query({ error: 'access_denied', state });

    expect(redirectError(response)).toBe('GOOGLE_SIGN_IN_FAILED');
    expect(await app.prisma.user.count()).toBe(0);
  });

  it('spends the state cookie on the way through, so a callback cannot be replayed', async () => {
    const app = getApp();

    const response = await signInWithGoogle(app.client, app.google, SOMCHAI);

    // Cleared whatever the outcome was. A state good for ten minutes and any number of callbacks
    // is a state that is doing half its job.
    expect(setCookie(response, OAUTH_STATE_COOKIE)).toBeUndefined();
  });
});
