import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { CURRENT_PRIVACY_POLICY_VERSION, CURRENT_TERMS_OF_SERVICE_VERSION } from '../src/legal/policy-version.js';
import { registerVerified } from './helpers/arrange.js';
import { API, GOOD_PASSWORD, csrfToken, redirectError, register, signInWithGoogle } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §90 — the terms of service acceptance, recorded clickwrap-style next to the privacy policy one.
 *
 * The owner chose: one checkbox on the sign-up form that links both documents, the Google button
 * disabled until it is ticked, the current draft as the first version, and no re-acceptance for
 * existing accounts yet. The backend's half of that is the record: one row per document, naming
 * the version the page showed, written in the same transaction as the account.
 *
 * Seam 1 throughout (M5): every arrangement is a request a browser could make.
 */
const getApp = setupTestApp();

const SOMCHAI = 'somchai@example.test';

/** The terms acceptances on file for one address, oldest first — read for assertions only. */
async function termsAcceptancesFor(
  app: TestApp,
  email: string,
): Promise<{ policyVersion: string; acceptedAt: Date }[]> {
  return app.prisma.policyAcceptance.findMany({
    where: { user: { email }, document: 'TERMS_OF_SERVICE' },
    select: { policyVersion: true, acceptedAt: true },
    orderBy: { id: 'asc' },
  });
}

describe('§90 — the version the sign-up form has to send', () => {
  it('is served without signing in, and is the date of the current draft', async () => {
    const { client } = getApp();

    const response = await client.get(`${API}/legal/terms-of-service`).expect(200);

    expect(response.body).toEqual({ version: '2026-09-29' }); // §98 filled in clause 3.2 (age)
    expect(CURRENT_TERMS_OF_SERVICE_VERSION).toBe('2026-09-29');
  });
});

describe('§90 — registering records the terms that were accepted', () => {
  it('stores one row per document, each with the version shown and the same instant', async () => {
    const app = getApp();

    await register(newClient(app), SOMCHAI);

    const rows = await app.prisma.policyAcceptance.findMany({
      where: { user: { email: SOMCHAI } },
      select: { document: true, policyVersion: true, acceptedAt: true },
      orderBy: { document: 'asc' },
    });
    expect(rows).toEqual([
      { document: 'PRIVACY_POLICY', policyVersion: CURRENT_PRIVACY_POLICY_VERSION, acceptedAt: app.clock.now() },
      { document: 'TERMS_OF_SERVICE', policyVersion: CURRENT_TERMS_OF_SERVICE_VERSION, acceptedAt: app.clock.now() },
    ]);
  });

  it('refuses a registration that accepts the privacy policy but not the terms', async () => {
    const app = getApp();
    const client = newClient(app);

    const response = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({ email: SOMCHAI, password: GOOD_PASSWORD, acceptedPrivacyPolicyVersion: CURRENT_PRIVACY_POLICY_VERSION })
      .expect(400);

    const body = response.body as ErrorBody;
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fieldErrors).toHaveProperty('acceptedTermsOfServiceVersion');
    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(0);
  });

  it('refuses stale terms with the same code a stale policy gets, and records nothing', async () => {
    const app = getApp();
    const client = newClient(app);

    const response = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({
        email: SOMCHAI,
        password: GOOD_PASSWORD,
        acceptedPrivacyPolicyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        acceptedTermsOfServiceVersion: '2019-01-01',
        confirmedAgeOrGuardianConsent: true, // §98
      })
      .expect(409);

    // One checkbox covers both documents, so the frontend's move is the same whichever one went
    // stale: reload, show the live wording, ask again. One code is all it needs to know.
    const body = response.body as ErrorBody;
    expect(body.code).toBe('POLICY_VERSION_OUTDATED');
    expect(body.message).toContain('ข้อตกลงการใช้บริการ');
    expect(await app.prisma.policyAcceptance.count()).toBe(0);
    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(0);
  });

  it('records nothing extra when the address is already taken', async () => {
    const app = getApp();

    await register(newClient(app), SOMCHAI);
    await register(newClient(app), SOMCHAI);

    expect(await termsAcceptancesFor(app, SOMCHAI)).toHaveLength(1);
  });
});

describe('§90 — Google needs the ticked box too', () => {
  it('records the terms for an account created through Google', async () => {
    const app = getApp();

    const response = await signInWithGoogle(newClient(app), app.google, SOMCHAI);

    expect(redirectError(response)).toBeNull();
    expect(await termsAcceptancesFor(app, SOMCHAI)).toEqual([
      { policyVersion: CURRENT_TERMS_OF_SERVICE_VERSION, acceptedAt: app.clock.now() },
    ]);
  });

  it('refuses to create an account when the terms version is missing or stale', async () => {
    const app = getApp();

    const missing = await signInWithGoogle(newClient(app), app.google, 'first@gmail.com', { termsVersion: null });
    const stale = await signInWithGoogle(newClient(app), app.google, 'second@gmail.com', { termsVersion: '1999-01-01' });

    expect(redirectError(missing)).toBe('POLICY_VERSION_OUTDATED');
    expect(redirectError(stale)).toBe('POLICY_VERSION_OUTDATED');
    expect(await app.prisma.user.count({ where: { email: { in: ['first@gmail.com', 'second@gmail.com'] } } })).toBe(0);
    expect(await app.prisma.policyAcceptance.count()).toBe(0);
  });

  it('an over-long terms version is dropped at the start route and the sign-up is refused', async () => {
    const app = getApp();

    const response = await signInWithGoogle(newClient(app), app.google, SOMCHAI, { termsVersion: 'x'.repeat(33) });

    expect(redirectError(response)).toBe('POLICY_VERSION_OUTDATED');
    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(0);
  });

  it('an existing account signs in without one, and no row is added', async () => {
    const app = getApp();
    await signInWithGoogle(newClient(app), app.google, SOMCHAI);

    const again = await signInWithGoogle(newClient(app), app.google, SOMCHAI, { termsVersion: null, policyVersion: null });

    // Owner's answer: record at sign-up only. Re-acceptance is a later ticket, so an account that
    // exists is not asked again and signing in is not accepting.
    expect(redirectError(again)).toBeNull();
    expect(await termsAcceptancesFor(app, SOMCHAI)).toHaveLength(1);
  });
});

describe('§90 — an erasure leaves the acceptance standing', () => {
  it('keeps the terms record after the account is erased', async () => {
    const app = getApp();
    const client = newClient(app);

    const id = await registerVerified(app, client, SOMCHAI);
    await client
      .post(`${API}/auth/account/erase`)
      .set(CSRF_HEADER, await csrfToken(client))
      .expect(204);

    // Same reasoning as the privacy row: a version and an instant name nobody once `User` is
    // anonymised, and the record that an account agreed to the terms is the evidence (§90).
    expect(await app.prisma.policyAcceptance.count({ where: { userId: id, document: 'TERMS_OF_SERVICE' } })).toBe(1);
  });
});
