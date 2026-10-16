import type { ErrorBody } from '../src/common/errors/error-payload.js';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { API, CURRENT_ACCEPTANCES, GOOD_PASSWORD, csrfToken, login, redirectError, signInWithGoogle } from './helpers/auth.js';
import { registerVerified } from './helpers/arrange.js';
import { newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §98 (owner's decision in §93): signing up asks the person to confirm "อายุ 20 ปีขึ้นไป หรือ
 * ผู้ปกครองรับทราบและยินยอมแล้ว" — a tick, not a date of birth, which is never asked or stored.
 * Both doors ask: the sign-up form and the page around the Google button.
 *
 * Nothing returns `ageConfirmedAt` (it is a record for the platform, not something the person
 * needs to see), so the assertions that it was kept read the row.
 */
const getApp = setupTestApp();

const USER = 'user@example.test';

async function registerWith(body: Record<string, unknown>) {
  const client = newClient(getApp());
  return client
    .post(`${API}/auth/register`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ email: USER, password: GOOD_PASSWORD, ...body });
}

describe('§98 — signing up confirms age (or a guardian’s consent), both ways in', () => {
  it('refuses a sign-up that does not confirm it — no account is created', async () => {
    const app = getApp();
    const response = await registerWith({
      acceptedPrivacyPolicyVersion: CURRENT_ACCEPTANCES.acceptedPrivacyPolicyVersion,
      acceptedTermsOfServiceVersion: CURRENT_ACCEPTANCES.acceptedTermsOfServiceVersion,
    });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).fieldErrors).toHaveProperty('confirmedAgeOrGuardianConsent');
    expect(await app.prisma.user.count({ where: { email: USER } })).toBe(0); // no response says whether an account exists (I16) — read the table
  });

  it('refuses false — an unticked box is not a confirmation', async () => {
    const response = await registerWith({ ...CURRENT_ACCEPTANCES, confirmedAgeOrGuardianConsent: false });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).fieldErrors).toHaveProperty('confirmedAgeOrGuardianConsent');
  });

  it('keeps when it was confirmed, and no date of birth', async () => {
    const app = getApp();
    await registerVerified(app, newClient(app), USER);

    // No endpoint returns it (see the file comment).
    const row = await app.prisma.user.findUniqueOrThrow({ where: { email: USER } });
    expect(row.ageConfirmedAt).toEqual(app.clock.now());
    expect(Object.keys(row).some((key) => /birth/i.test(key))).toBe(false);
  });

  it('refuses a new Google account the page did not confirm age for — and creates nothing', async () => {
    const app = getApp();
    const client = newClient(app);

    const callback = await signInWithGoogle(client, app.google, USER, { ageConfirmed: false });

    expect(redirectError(callback)).toBe('AGE_CONFIRMATION_REQUIRED');
    expect(await app.prisma.user.count({ where: { email: USER } })).toBe(0); // no response says whether an account exists (I16) — read the table
  });

  it('creates a Google account when the page confirmed it, and keeps when', async () => {
    const app = getApp();
    const client = newClient(app);

    const callback = await signInWithGoogle(client, app.google, USER);

    expect(redirectError(callback)).toBeNull();
    const row = await app.prisma.user.findUniqueOrThrow({ where: { email: USER } });
    expect(row.ageConfirmedAt).toEqual(app.clock.now());
  });

  it('an existing account signs in with Google without being asked again', async () => {
    const app = getApp();
    await registerVerified(app, newClient(app), USER);
    // §101: a verified account with a password connects to Google only while signed in with it.
    const client = newClient(app);
    expect((await login(client, USER)).status).toBe(200);

    const callback = await signInWithGoogle(client, app.google, USER, { ageConfirmed: false, policyVersion: null, termsVersion: null });

    expect(redirectError(callback)).toBeNull();
    expect((await client.get(`${API}/auth/me`)).status).toBe(200);
    expect((await login(newClient(app), USER)).status).toBe(200);
  });
});
