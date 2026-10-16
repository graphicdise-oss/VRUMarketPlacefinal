import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { CURRENT_PRIVACY_POLICY_VERSION, CURRENT_TERMS_OF_SERVICE_VERSION } from '../src/legal/policy-version.js';
import { registerVerified } from './helpers/arrange.js';
import { API, GOOD_PASSWORD, csrfToken, register, signInWithGoogle } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #75 (§66) — the privacy policy acceptance recorded at sign-up.
 *
 * The owner chose "link in the footer + a mandatory checkbox at signup". What makes that checkbox
 * worth anything is the record behind it, so these tests are mostly about the record: that it
 * exists, that it names the version the person was actually shown, and that there is no way to end
 * up with an account that has none.
 *
 * Seam 1 throughout (M5): every arrangement is a request a browser could make.
 */
const getApp = setupTestApp();

const SOMCHAI = 'somchai@example.test';

/**
 * The privacy policy acceptances on file for one address, newest last — read for assertions only.
 * Since §90 the same table also holds terms of service acceptances; those have their own spec.
 */
async function acceptancesFor(
  app: TestApp,
  email: string,
): Promise<{ policyVersion: string; acceptedAt: Date }[]> {
  return app.prisma.policyAcceptance.findMany({
    where: { user: { email }, document: 'PRIVACY_POLICY' },
    select: { policyVersion: true, acceptedAt: true },
    orderBy: { id: 'asc' },
  });
}

describe('#75 — the version the sign-up form has to send', () => {
  it('is served without signing in, because nobody has an account at that point', async () => {
    const { client } = getApp();

    const response = await client.get(`${API}/legal/privacy-policy`).expect(200);

    expect(response.body).toEqual({ version: CURRENT_PRIVACY_POLICY_VERSION });
  });
});

describe('#75 — registering records what was accepted', () => {
  it('stores the version and the instant it was accepted', async () => {
    const app = getApp();

    await register(newClient(app), SOMCHAI);

    // The clock's instant, not "roughly now". An acceptance timestamped from `new Date()` would
    // drift from every other instant in the system, and this is a record meant to be evidence.
    expect(await acceptancesFor(app, SOMCHAI)).toEqual([
      { policyVersion: CURRENT_PRIVACY_POLICY_VERSION, acceptedAt: app.clock.now() },
    ]);
  });

  it('refuses a registration that does not accept anything', async () => {
    const app = getApp();
    const client = newClient(app);

    const response = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({ email: SOMCHAI, password: GOOD_PASSWORD })
      .expect(400);

    const body = response.body as ErrorBody;
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fieldErrors).toHaveProperty('acceptedPrivacyPolicyVersion');

    // The point of the 400: no account came into being without an acceptance behind it.
    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(0);
  });

  it('refuses a stale version rather than filing it as agreed', async () => {
    const app = getApp();
    const client = newClient(app);

    const response = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({
        email: SOMCHAI,
        password: GOOD_PASSWORD,
        acceptedPrivacyPolicyVersion: '2019-01-01',
        acceptedTermsOfServiceVersion: CURRENT_TERMS_OF_SERVICE_VERSION,
        confirmedAgeOrGuardianConsent: true, // §98
      })
      .expect(409);

    // Not CONFLICT: the frontend's move here is "reload and show the live wording", which is
    // different from "refresh and retry", and it cannot tell them apart without its own code.
    expect((response.body as ErrorBody).code).toBe('POLICY_VERSION_OUTDATED');

    // Recording it anyway would file a record saying this person agreed to text they never saw,
    // which is the one outcome this whole mechanism exists to prevent.
    expect(await app.prisma.policyAcceptance.count()).toBe(0);
    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(0);
  });

  it('records nothing extra when the address is already taken', async () => {
    const app = getApp();

    await register(newClient(app), SOMCHAI);
    // Answers 202 either way (I16) — the second attempt must still leave one acceptance, not two,
    // or the count would say how many times an address has been tried.
    await register(newClient(app), SOMCHAI);

    expect(await app.prisma.policyAcceptance.count({ where: { document: 'PRIVACY_POLICY' } })).toBe(1);
  });
});

describe('#75 — Google is not the quiet way around the checkbox', () => {
  it('records an acceptance for an account created through Google', async () => {
    const app = getApp();
    const client = newClient(app);

    await signInWithGoogle(client, app.google, SOMCHAI);

    // There is no form on this path, so the notice beside the button is what the person agreed to
    // — but the record has to exist all the same, or Google becomes a population of accounts with
    // no acceptance behind them that nobody notices until it matters.
    expect(await acceptancesFor(app, SOMCHAI)).toEqual([
      { policyVersion: CURRENT_PRIVACY_POLICY_VERSION, acceptedAt: app.clock.now() },
    ]);
  });

  it('does not add another one on every later sign-in', async () => {
    const app = getApp();
    const client = newClient(app);

    await signInWithGoogle(client, app.google, SOMCHAI);
    await signInWithGoogle(newClient(app), app.google, SOMCHAI);

    // Signing in is not accepting. A row per sign-in would turn an evidence table into a login
    // log, and would make "when did this person accept" unanswerable by drowning it.
    expect(await acceptancesFor(app, SOMCHAI)).toHaveLength(1);
  });
});

describe('#75 — an erasure leaves the acceptance standing', () => {
  it('keeps the record after the account is erased', async () => {
    const app = getApp();
    const client = newClient(app);

    const id = await registerVerified(app, client, SOMCHAI);
    const signedIn = client;
    await signedIn
      .post(`${API}/auth/account/erase`)
      .set(CSRF_HEADER, await csrfToken(signedIn))
      .expect(204);

    // A version string and an instant name nobody once the `User` row is anonymised, so there is
    // nothing here for an erasure to remove — and the record that an account accepted a given
    // version is what makes the acceptance provable at all.
    expect(await app.prisma.policyAcceptance.count({ where: { userId: id, document: 'PRIVACY_POLICY' } })).toBe(1);
  });
});
