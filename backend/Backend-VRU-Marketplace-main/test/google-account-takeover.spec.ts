import type { Agent } from 'supertest';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../src/auth/cookies.js';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import {
  API,
  csrfToken,
  forgotPassword,
  linkTokenFrom,
  login,
  redirectError,
  register,
  resetPassword,
  setCookie,
  signInWithGoogle,
  verifyEmail,
} from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §101: pre-account takeover through Google (found scrutinizing area 3).
 *
 * Somebody registers an address they cannot read and sets a password they know. Before this, the
 * address's owner — told EMAIL_NOT_VERIFIED by Google sign-in and sent to "request a new
 * verification link" — verified it for them, signed in with Google, and ended up sharing the
 * account with whoever held the password.
 *
 * The owner's decision is both halves of the practice the research recommends:
 *   - an unverified account belongs to nobody yet: Google's proof of the address wins it, and the
 *     password somebody set there without proving anything is thrown away with every session;
 *   - a verified account with a password is connected to Google only by someone who proves that
 *     password first (signed in with it), and after that is recognised by Google's own id.
 */
const getApp = setupTestApp();

const OWNER = 'owner@gmail.test';
const SQUATTER_PASSWORD = 'the-squatter-knows-this-one';
const OWNER_PASSWORD = 'the-owner-chose-this-later';

async function me(client: Agent): Promise<{ status: number; id?: string }> {
  const response = await client.get(`${API}/auth/me`);
  return { status: response.status, id: (response.body as { id?: string }).id };
}

/** A squatter's account for OWNER: registered with their password, and signed in on their device. */
async function squatted(app: TestApp): Promise<{ squatter: Agent; accountId: string }> {
  const squatter = newClient(app);
  await register(squatter, OWNER, SQUATTER_PASSWORD);
  expect((await login(squatter, OWNER, SQUATTER_PASSWORD)).status).toBe(200);
  return { squatter, accountId: (await me(squatter)).id! };
}

describe('§101 — an unverified account belongs to nobody yet: Google’s proof of the address wins it', () => {
  it('the owner signing in with Google gets the address, and the squatter’s session and password stop working', async () => {
    const app = getApp();
    const { squatter, accountId } = await squatted(app);

    const owner = newClient(app);
    const response = await signInWithGoogle(owner, app.google, OWNER);

    expect(redirectError(response)).toBeNull();
    const signedIn = await me(owner);
    expect(signedIn.status).toBe(200);
    // A fresh account, not the squatter's row with a new owner: nothing they made comes along.
    expect(signedIn.id).not.toBe(accountId);
    expect((await me(squatter)).status).toBe(401);
    expect((await login(newClient(app), OWNER, SQUATTER_PASSWORD)).status).toBe(401);
  });

  it('nothing the squatter created comes with it — no delivery address of theirs waits on the owner’s first order', async () => {
    const app = getApp();
    const { squatter } = await squatted(app);
    // No endpoint lists the area reference data by id — the address form's value, read directly.
    const subdistrictPostalCodeId = (await app.prisma.subdistrictPostalCode.findFirstOrThrow()).id;
    const planted = await squatter
      .post(`${API}/addresses`)
      .set(CSRF_HEADER, await csrfToken(squatter))
      .send({ recipientName: 'คนดัก รับของแทน', phone: '0899999999', houseNumber: '1/1', subdistrictPostalCodeId });
    expect(planted.status).toBe(201);

    const owner = newClient(app);
    expect(redirectError(await signInWithGoogle(owner, app.google, OWNER))).toBeNull();

    const addresses = await owner.get(`${API}/addresses`);
    expect(addresses.status).toBe(200);
    expect((addresses.body as { items: unknown[] }).items).toEqual([]);
  });

  it('the owner is asked for their own consent — the squatter’s acceptance and age box do not count for them', async () => {
    const app = getApp();
    const { squatter } = await squatted(app);

    const refused = await signInWithGoogle(newClient(app), app.google, OWNER, { ageConfirmed: false });

    expect(redirectError(refused)).toBe('AGE_CONFIRMATION_REQUIRED');
    // Refused before anything changed: the squatter is not even signed out by a sign-in that failed.
    expect((await me(squatter)).status).toBe(200);
  });

  it('the owner is not told their account was erased — closing the squatter’s is not the owner’s PDPA request', async () => {
    const app = getApp();
    await squatted(app);
    app.email.clear();

    expect(redirectError(await signInWithGoogle(newClient(app), app.google, OWNER))).toBeNull();

    expect(app.email.ofKind('ACCOUNT_ERASURE')).toEqual([]);
  });

  it('a verification or reset link the squatter had waiting is spent with it', async () => {
    const app = getApp();
    await squatted(app);
    const registrationLink = linkTokenFrom(app.email.ofKind('EMAIL_VERIFICATION').at(-1)!.body);
    app.email.clear();
    await forgotPassword(newClient(app), OWNER);
    const resetLink = linkTokenFrom(app.email.ofKind('PASSWORD_RESET').at(-1)!.body);

    expect(redirectError(await signInWithGoogle(newClient(app), app.google, OWNER))).toBeNull();

    expect((await resetPassword(newClient(app), resetLink, 'a-password-from-an-old-link')).status).toBe(400);
    expect((await verifyEmail(newClient(app), registrationLink)).status).toBe(400);
  });
});

describe('§101 — a verified account with a password connects to Google only after its password is proven', () => {
  it('Google alone is refused; signed in with the password, the same Google sign-in connects it — and from then on Google alone works', async () => {
    const app = getApp();
    const owner = newClient(app);
    await register(owner, OWNER, OWNER_PASSWORD);
    expect((await verifyEmail(owner, linkTokenFrom(app.email.ofKind('EMAIL_VERIFICATION').at(-1)!.body))).status).toBe(204);
    const accountId = (await me(await signedIn(app, OWNER_PASSWORD))).id;

    const googleOnly = await signInWithGoogle(newClient(app), app.google, OWNER);
    expect(redirectError(googleOnly)).toBe('GOOGLE_LINK_REQUIRES_PASSWORD');
    expect(setCookie(googleOnly, ACCESS_TOKEN_COOKIE)).toBeUndefined();

    const withPassword = await signedIn(app, OWNER_PASSWORD);
    expect(redirectError(await signInWithGoogle(withPassword, app.google, OWNER))).toBeNull();
    expect(await me(withPassword)).toEqual({ status: 200, id: accountId });

    const later = newClient(app);
    expect(redirectError(await signInWithGoogle(later, app.google, OWNER))).toBeNull();
    expect(await me(later)).toEqual({ status: 200, id: accountId });
  });

  it('the owner who clicked the verification email a squatter caused cannot be signed into it by Google — a reset takes it back', async () => {
    const app = getApp();
    const { squatter } = await squatted(app);
    // The one path the first half leaves: the owner clicks the link the squatter's registration sent
    // them, despite the email saying "ignore this if you did not sign up".
    expect((await verifyEmail(newClient(app), linkTokenFrom(app.email.ofKind('EMAIL_VERIFICATION').at(-1)!.body))).status).toBe(204);

    expect(redirectError(await signInWithGoogle(newClient(app), app.google, OWNER))).toBe('GOOGLE_LINK_REQUIRES_PASSWORD');

    // "Forgot password" proves the inbox and replaces the password — the squatter is out.
    app.email.clear();
    await forgotPassword(newClient(app), OWNER);
    expect((await resetPassword(newClient(app), linkTokenFrom(app.email.ofKind('PASSWORD_RESET').at(-1)!.body), OWNER_PASSWORD)).status).toBe(204);
    expect((await me(squatter)).status).toBe(401);
    expect((await login(newClient(app), OWNER, SQUATTER_PASSWORD)).status).toBe(401);

    const owner = await signedIn(app, OWNER_PASSWORD);
    expect(redirectError(await signInWithGoogle(owner, app.google, OWNER))).toBeNull();
  });

  it('an owner signed in with the password whose 15-minute access token ran out on the way to Google still connects', async () => {
    const app = getApp();
    const owner = newClient(app);
    await register(owner, OWNER, OWNER_PASSWORD);
    await verifyEmail(owner, linkTokenFrom(app.email.ofKind('EMAIL_VERIFICATION').at(-1)!.body));
    const withPassword = await signedIn(app, OWNER_PASSWORD);
    const accountId = (await me(withPassword)).id;
    app.clock.advanceByMinutes(20); // the refresh cookie is still good; the access cookie is not

    expect(redirectError(await signInWithGoogle(withPassword, app.google, OWNER))).toBeNull();
    expect(await me(withPassword)).toEqual({ status: 200, id: accountId });
  });

  it('a signed-out browser’s refresh cookie proves nothing — logging out revoked it', async () => {
    const app = getApp();
    const owner = newClient(app);
    await register(owner, OWNER, OWNER_PASSWORD);
    await verifyEmail(owner, linkTokenFrom(app.email.ofKind('EMAIL_VERIFICATION').at(-1)!.body));
    const device = newClient(app);
    const refreshToken = setCookie(await login(device, OWNER, OWNER_PASSWORD), REFRESH_TOKEN_COOKIE)!;
    expect((await device.post(`${API}/auth/logout`).set(CSRF_HEADER, await csrfToken(device))).status).toBe(204);

    // The browser dropped the cookie when it logged out; somebody who copied it earlier did not.
    const copied = newClient(app);
    copied.jar.setCookie(`${REFRESH_TOKEN_COOKIE}=${refreshToken}; Path=/api/v1/auth`, '127.0.0.1', '/');
    expect(redirectError(await signInWithGoogle(copied, app.google, OWNER))).toBe('GOOGLE_LINK_REQUIRES_PASSWORD');
  });

  it('being signed in as somebody else connects nothing — the Google sign-in is refused like any other', async () => {
    const app = getApp();
    const owner = newClient(app);
    await register(owner, OWNER, OWNER_PASSWORD);
    await verifyEmail(owner, linkTokenFrom(app.email.ofKind('EMAIL_VERIFICATION').at(-1)!.body));
    const someoneElse = newClient(app);
    await register(someoneElse, 'someone.else@example.test', OWNER_PASSWORD);
    await login(someoneElse, 'someone.else@example.test', OWNER_PASSWORD);

    expect(redirectError(await signInWithGoogle(someoneElse, app.google, OWNER))).toBe('GOOGLE_LINK_REQUIRES_PASSWORD');
  });
});

describe('§101 — a connected account is recognised by Google’s own id, not by the address alone', () => {
  it('the same address arriving with a different Google id (a deleted and recreated workplace account) is refused', async () => {
    const app = getApp();
    expect(redirectError(await signInWithGoogle(newClient(app), app.google, OWNER, { subject: 'google-id-1' }))).toBeNull();

    const recycled = await signInWithGoogle(newClient(app), app.google, OWNER, { subject: 'google-id-2' });

    expect(redirectError(recycled)).toBe('GOOGLE_SIGN_IN_FAILED');
    expect(setCookie(recycled, ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  it('an account erased under PDPA lets go of its Google id — the same person coming back gets a fresh, working account', async () => {
    const app = getApp();
    const first = newClient(app);
    await signInWithGoogle(first, app.google, OWNER, { subject: 'google-id-1' });
    const erasedId = (await me(first)).id;
    expect((await first.post(`${API}/auth/account/erase`).set(CSRF_HEADER, await csrfToken(first))).status).toBe(204);

    const back = newClient(app);
    expect(redirectError(await signInWithGoogle(back, app.google, OWNER, { subject: 'google-id-1' }))).toBeNull();
    const now = await me(back);
    expect(now.status).toBe(200);
    expect(now.id).not.toBe(erasedId);
  });
});

async function signedIn(app: TestApp, password: string): Promise<Agent> {
  const client = newClient(app);
  expect((await login(client, OWNER, password)).status).toBe(200);
  return client;
}
