import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../src/auth/cookies.js';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import {
  API,
  CURRENT_ACCEPTANCES,
  GOOD_PASSWORD,
  csrfToken,
  login,
  register,
  registerAndLogin,
  setCookie,
  setCookieAttributes,
} from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import type { Agent } from 'supertest';
import { AccountMarkerService } from '../src/auth/account-marker.service.js';

const getApp = setupTestApp();

const ADMIN = 'superadmin@example.test';
const SOMCHAI = 'somchai@example.test';

/**
 * Signs somebody in and promotes them to super admin.
 *
 * The role is set directly, because the only thing that creates the first super admin is the seed
 * script K2 describes, and that belongs to topic 3. Arranging state through prisma is what the
 * test helper exposes it for; everything the test then *asserts* goes through HTTP.
 */
async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, ADMIN);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: ADMIN }, data: { role: 'SUPER_ADMIN' } });
}

async function userIdOf(app: TestApp, email: string): Promise<string> {
  const user = await app.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return user.id;
}

async function ban(
  client: Agent,
  userId: string,
  reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง',
) {
  return client
    .post(`${API}/admin/users/${userId}/ban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function unban(client: Agent, userId: string) {
  return client
    .post(`${API}/admin/users/${userId}/unban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({});
}

describe('who may ban', () => {
  it('refuses an ordinary signed-in user', async () => {
    const app = getApp();
    const somchai = app.client;

    await registerAndLogin(somchai, SOMCHAI);
    const victim = newClient(app);
    await registerAndLogin(victim, 'victim@example.test');

    const response = await ban(somchai, await userIdOf(app, 'victim@example.test'));

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('FORBIDDEN');
  });

  it('refuses somebody who is not signed in at all', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    const anonymous = newClient(app);

    const response = await ban(anonymous, await userIdOf(app, SOMCHAI));

    expect(response.status).toBe(401);
  });

  it('refuses a super admin who tries to ban themselves', async () => {
    const app = getApp();
    const admin = app.client;

    await signInAsSuperAdmin(app, admin);

    // There is one super admin (K2), and a self-ban cannot be undone by anybody — including them.
    const response = await ban(admin, await userIdOf(app, ADMIN));

    expect(response.status).toBe(403);
  });

  it('refuses a ban with no reason, naming the field', async () => {
    const app = getApp();
    const admin = app.client;

    await signInAsSuperAdmin(app, admin);
    await register(newClient(app), SOMCHAI);

    const response = await admin
      .post(`${API}/admin/users/${await userIdOf(app, SOMCHAI)}/ban`)
      .set(CSRF_HEADER, await csrfToken(admin))
      .send({});

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).fieldErrors?.reason).toBeDefined();
  });

  it('answers 404 for an account that does not exist', async () => {
    const app = getApp();
    const admin = app.client;

    await signInAsSuperAdmin(app, admin);

    const response = await ban(admin, newId());

    expect(response.status).toBe(404);
  });
});

describe('a ban takes effect on the next request (invariant 7)', () => {
  it('kills a cookie that was issued before the ban and has not expired', async () => {
    const app = getApp();
    const admin = app.client;
    const somchai = newClient(app);

    await signInAsSuperAdmin(app, admin);
    await registerAndLogin(somchai, SOMCHAI);
    await somchai.get(`${API}/auth/me`).expect(200);

    await ban(admin, await userIdOf(app, SOMCHAI)).then((it) => {
      expect(it.status).toBe(204);
    });

    // No clock movement, no new sign-in: the very next request with the cookie already in the
    // browser. This is the acceptance criterion the whole ticket exists for — a system that
    // trusted the token would keep working here for up to fifteen minutes.
    const response = await somchai.get(`${API}/auth/me`);

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('ACCOUNT_BANNED');
  });

  it('stops the refresh token from producing a new one, by either door', async () => {
    const app = getApp();
    const admin = app.client;
    const somchai = newClient(app);

    await signInAsSuperAdmin(app, admin);
    const signedIn = await registerAndLogin(somchai, SOMCHAI);
    const refreshCookie = setCookie(signedIn, REFRESH_TOKEN_COOKIE);

    // Taken while still allowed: after the ban this client cannot even fetch one, which is itself
    // the point. It stays valid because it is bound to the session, not to the access token.
    const csrf = await csrfToken(somchai);

    await ban(admin, await userIdOf(app, SOMCHAI));

    // Door one: the browser still has both cookies. The guard sees a banned account before the
    // handler runs, so the answer is the useful one rather than a generic timeout.
    const withAccessCookie = await somchai.post(`${API}/auth/refresh`).set(CSRF_HEADER, csrf);
    expect(withAccessCookie.status).toBe(403);
    expect((withAccessCookie.body as ErrorBody).code).toBe('ACCOUNT_BANNED');

    // Door two: only the refresh cookie, which is the state a browser reaches once the access
    // cookie passes its own max-age. Nothing has looked at the account yet, so this is the check
    // inside `rotate` — without it a banned account could keep minting fifteen-minute tokens for
    // thirty days.
    const refreshOnly = await newClient(app)
      .post(`${API}/auth/refresh`)
      .set(CSRF_HEADER, csrf)
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${refreshCookie ?? ''}`);

    expect(refreshOnly.status).toBe(401);
  });

  it('stops a cookie replayed from a client that never saw the ban', async () => {
    const app = getApp();
    const admin = app.client;
    const somchai = newClient(app);

    await signInAsSuperAdmin(app, admin);
    const signedIn = await registerAndLogin(somchai, SOMCHAI);
    const stolenCookie = setCookie(signedIn, ACCESS_TOKEN_COOKIE);

    await ban(admin, await userIdOf(app, SOMCHAI));

    const thief = await newClient(app)
      .get(`${API}/auth/me`)
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${stolenCookie ?? ''}`);

    expect(thief.status).toBe(403);
  });

  it('takes the cookies back with the refusal, so the person can keep browsing', async () => {
    const app = getApp();
    const admin = app.client;
    const somchai = newClient(app);

    await signInAsSuperAdmin(app, admin);
    await registerAndLogin(somchai, SOMCHAI);

    await ban(admin, await userIdOf(app, SOMCHAI));

    const refused = await somchai.get(`${API}/auth/me`);

    expect(refused.status).toBe(403);
    expect((refused.body as ErrorBody).code).toBe('ACCOUNT_BANNED');

    // Both cookies are expired on the way out. This is not tidiness: they are httpOnly, so
    // FRONTEND-NOTES' instruction for this code ("clear client state and keep browsing") is
    // something the frontend cannot carry out on its own, and POST /auth/logout — the one
    // endpoint that would have cleared them — is refused by this very check before it can run.
    expect(setCookieAttributes(refused, ACCESS_TOKEN_COOKIE)).toContain('expires=thu, 01 jan 1970');
    expect(setCookieAttributes(refused, REFRESH_TOKEN_COOKIE)).toContain(
      'expires=thu, 01 jan 1970',
    );

    // The same browser, one request later. Invariant 1: looking at what is for sale never needed
    // an account, and a banned person is not banned from the shopfront. Before the line above
    // existed this answered 403 too — every request did, for the fifteen minutes it took the
    // access cookie to reach its own max-age.
    await somchai.get(`${API}/products`).expect(200);
  });

  it('refuses a fresh sign-in with a code that is not "wrong password"', async () => {
    const app = getApp();
    const admin = app.client;
    const somchai = newClient(app);

    await signInAsSuperAdmin(app, admin);
    await registerAndLogin(somchai, SOMCHAI);
    await ban(admin, await userIdOf(app, SOMCHAI));

    const response = await login(newClient(app), SOMCHAI);

    // The person has to know to contact somebody rather than to try another password.
    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('ACCOUNT_BANNED');
  });

  it('refuses to ban somebody twice', async () => {
    const app = getApp();
    const admin = app.client;

    await signInAsSuperAdmin(app, admin);
    await register(newClient(app), SOMCHAI);
    const somchaiId = await userIdOf(app, SOMCHAI);

    await ban(admin, somchaiId);
    const second = await ban(admin, somchaiId);

    // Two admins acting at once should not both believe they were the one who did it, and the
    // audit log should not describe a change that did not happen.
    expect(second.status).toBe(409);
    expect(await app.prisma.auditLog.count({ where: { action: 'USER_BANNED' } })).toBe(1);
  });
});

describe('lifting a ban', () => {
  it('lets the account sign in again', async () => {
    const app = getApp();
    const admin = app.client;
    const somchai = newClient(app);

    await signInAsSuperAdmin(app, admin);
    await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = await userIdOf(app, SOMCHAI);

    await ban(admin, somchaiId);
    expect((await unban(admin, somchaiId)).status).toBe(204);

    const fresh = newClient(app);
    expect((await login(fresh, SOMCHAI)).status).toBe(200);
    await fresh.get(`${API}/auth/me`).expect(200);
  });

  it('does not bring the revoked sessions back', async () => {
    const app = getApp();
    const admin = app.client;
    const somchai = newClient(app);

    await signInAsSuperAdmin(app, admin);
    await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = await userIdOf(app, SOMCHAI);

    await ban(admin, somchaiId);
    await unban(admin, somchaiId);

    // The old cookie stays dead. A revoked session coming back to life is not something this
    // system should be able to do — the person signs in again.
    expect((await somchai.get(`${API}/auth/me`)).status).toBe(401);
  });

  it('refuses to lift a ban that is not there', async () => {
    const app = getApp();
    const admin = app.client;

    await signInAsSuperAdmin(app, admin);
    await register(newClient(app), SOMCHAI);

    expect((await unban(admin, await userIdOf(app, SOMCHAI))).status).toBe(409);
  });
});

describe('audit_log gets its first real entries', () => {
  it('records who banned whom, and why', async () => {
    const app = getApp();
    const admin = app.client;

    await signInAsSuperAdmin(app, admin);
    await register(newClient(app), SOMCHAI);
    const somchaiId = await userIdOf(app, SOMCHAI);
    const reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง';

    await ban(admin, somchaiId, reason);

    const entries = await app.prisma.auditLog.findMany({
      select: { actorUserId: true, action: true, targetType: true, targetId: true, reason: true },
    });

    expect(entries).toEqual([
      {
        actorUserId: await userIdOf(app, ADMIN),
        action: 'USER_BANNED',
        targetType: 'USER',
        targetId: somchaiId,
        reason,
      },
    ]);
  });

  it('records the unban too, with no reason required', async () => {
    const app = getApp();
    const admin = app.client;

    await signInAsSuperAdmin(app, admin);
    await register(newClient(app), SOMCHAI);
    const somchaiId = await userIdOf(app, SOMCHAI);

    await ban(admin, somchaiId);
    await unban(admin, somchaiId);

    const actions = await app.prisma.auditLog.findMany({
      select: { action: true, reason: true },
      orderBy: { id: 'asc' },
    });

    // USER_UNBANNED is not in ACTIONS_REQUIRING_REASON: the actions that need one are the ones
    // that take something away.
    expect(actions).toEqual([
      { action: 'USER_BANNED', reason: expect.any(String) as unknown as string },
      { action: 'USER_UNBANNED', reason: null },
    ]);
  });

  it('writes nothing when the ban was refused', async () => {
    const app = getApp();
    const admin = app.client;

    await signInAsSuperAdmin(app, admin);

    await ban(admin, newId());

    // An audit log that records attempts as if they were actions is a log nobody can trust.
    expect(await app.prisma.auditLog.count()).toBe(0);
  });
});

describe('K16 — somebody who was banned cannot come back under the same address', () => {
  /** Writes the marker topic 12 will write, so the check that reads it can be tested now. */
  async function markErased(app: TestApp, email: string, wasBanned: boolean): Promise<void> {
    await app.prisma.deletedAccountMarker.create({
      data: {
        id: newId(),
        emailHmac: hmacFor(app, email),
        deletedAt: app.clock.now(),
        wasBanned,
        disputeLostCount: 0,
      },
    });
  }

  /** The same digest the service computes — through the app's own service, not a copy of it. */
  function hmacFor(app: TestApp, email: string): string {
    // Reaching into the injector for a pure function, not for a service to drive: a second
    // implementation of the HMAC in the test would pass while the real one was broken.
    return app.app.get(AccountMarkerService).hash(email);
  }

  it('refuses the registration, and says exactly what a successful one says', async () => {
    const app = getApp();

    await markErased(app, SOMCHAI, true);

    const refused = await app.client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({
        email: SOMCHAI,
        password: GOOD_PASSWORD,
        ...CURRENT_ACCEPTANCES,
      });

    const accepted = await app.client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({
        email: 'newcomer@example.test',
        password: GOOD_PASSWORD,
        ...CURRENT_ACCEPTANCES,
      });

    // Identical, or the endpoint becomes a way to ask "was this address banned?".
    expect(refused.status).toBe(accepted.status);
    expect(refused.body).toEqual(accepted.body);

    // And nothing was created, or emailed.
    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(0);
    expect(app.email.to(SOMCHAI)).toEqual([]);
  });

  it('leaves the door open for somebody who was erased but never banned', async () => {
    const app = getApp();

    // K16: losing a dispute is not a ban. Those accounts may register again; what follows them is
    // a note an admin sees when they apply to open a shop, not a closed door.
    await markErased(app, SOMCHAI, false);

    await register(app.client, SOMCHAI);

    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(1);
  });

  it('matches regardless of how the address was capitalised', async () => {
    const app = getApp();

    await markErased(app, SOMCHAI, true);

    await app.client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({
        email: '  SomChai@Example.TEST ',
        password: GOOD_PASSWORD,
        ...CURRENT_ACCEPTANCES,
      })
      .expect(202);

    expect(await app.prisma.user.count()).toBe(0);
  });

  it('stores no address, only a digest', async () => {
    const app = getApp();

    await markErased(app, SOMCHAI, true);

    const markers = await app.prisma.deletedAccountMarker.findMany();

    // The whole point of K16's design: a copy of this table is not a list of people.
    expect(JSON.stringify(markers)).not.toContain(SOMCHAI);
    expect(markers[0]?.emailHmac).toMatch(/^[0-9a-f]{64}$/);
  });
});
