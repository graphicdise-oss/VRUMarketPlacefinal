import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #32: the two-tier guard every future community-admin action shares — a `CommunityAdmin` row
 * for the caller, whose `communityId` matches the target's shop. `ShopController`'s admin route
 * is the guard's only real target today (#32 explicitly forbids building any of the six actual
 * admin actions here); it exists so the guard has something to gate over HTTP.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const OWNER_A = 'owner-a@example.test';
const OWNER_B = 'owner-b@example.test';
const OWNER_C = 'owner-c@example.test';
const BUYER = 'buyer@example.test';

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function createCommunity(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin
    .post(`${API}/communities`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name, description: 'รายละเอียดสำหรับทดสอบ' });

  return (response.body as { id: string }).id;
}

async function assignAdmin(superAdmin: Agent, communityId: string, userId: string): Promise<void> {
  await superAdmin
    .post(`${API}/communities/${communityId}/admins`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ userId });
}

/** A shop owner who applied and was approved, the way topic 4 made real (#76 — was a direct insert). */
async function createShop(app: TestApp, communityId: string, ownerEmail: string): Promise<string> {
  const owner = newClient(app);
  await registerVerified(app, owner, ownerEmail);
  const applied = await owner.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(owner)).send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return shopId;
}

describe('the public shop view needs no session and no community membership (invariant 1)', () => {
  it('lets an anonymous caller view a shop in any community', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const shopId = await createShop(app, communityId, OWNER_A);

    // Not "a buyer of a different community" — genuinely nobody, no cookies at all. A1 says
    // browsing crosses communities without even needing an account.
    const response = await newClient(app).get(`${API}/shops/${shopId}`);

    expect(response.status).toBe(200);
    const body = response.body as { id: string; communityId: string; ownerId?: string };
    expect(body.id).toBe(shopId);
    expect(body.communityId).toBe(communityId);
    // The public view never reveals who owns the shop — that is the admin view's job.
    expect(body.ownerId).toBeUndefined();
  });

  it('answers 404 for a shop that does not exist, the same as any public lookup', async () => {
    const response = await newClient(getApp()).get(`${API}/shops/${newId()}`);

    expect(response.status).toBe(404);
  });
});

describe('the community-admin view of a shop — the two-tier guard (#32)', () => {
  it('lets a super admin view any shop, with no CommunityAdmin row at all', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const shopId = await createShop(app, communityId, OWNER_A);

    const response = await superAdmin.get(`${API}/shops/${shopId}/admin`);

    expect(response.status).toBe(200);
    const body = response.body as { id: string; ownerId: string };
    expect(body.id).toBe(shopId);
    expect(body.ownerId).not.toBe('');
  });

  it(
    "lets community A's admin view a shop in community A, but not a shop in community B — " +
      'the test CLAUDE.md\'s "นิยามของเสร็จ" requires',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
      const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
      const shopA = await createShop(app, communityA, OWNER_A);
      const shopB = await createShop(app, communityB, OWNER_B);

      const adminA = newClient(app);
      const adminASession = await registerAndLogin(adminA, ADMIN_A);
      const adminAId = (adminASession.body as { id: string }).id;
      await assignAdmin(superAdmin, communityA, adminAId);

      const ownShop = await adminA.get(`${API}/shops/${shopA}/admin`);
      const otherShop = await adminA.get(`${API}/shops/${shopB}/admin`);

      expect(ownShop.status).toBe(200);
      expect(otherShop.status).toBe(403);
      expect((otherShop.body as ErrorBody).code).toBe('FORBIDDEN');
    },
  );

  it('lets one admin of two communities view shops in both, but not a shop in a third', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const communityC = await createCommunity(superAdmin, 'ชุมชนพัทยา');
    const shopA = await createShop(app, communityA, OWNER_A);
    const shopB = await createShop(app, communityB, OWNER_B);
    const shopC = await createShop(app, communityC, OWNER_C);

    const admin = newClient(app);
    const adminSession = await registerAndLogin(admin, ADMIN_A);
    const adminId = (adminSession.body as { id: string }).id;
    await assignAdmin(superAdmin, communityA, adminId);
    await assignAdmin(superAdmin, communityB, adminId);

    const resultA = await admin.get(`${API}/shops/${shopA}/admin`);
    const resultB = await admin.get(`${API}/shops/${shopB}/admin`);
    const resultC = await admin.get(`${API}/shops/${shopC}/admin`);

    expect(resultA.status).toBe(200);
    expect(resultB.status).toBe(200);
    expect(resultC.status).toBe(403);
  });

  it('refuses an ordinary signed-in buyer with no CommunityAdmin row anywhere', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const shopId = await createShop(app, communityId, OWNER_A);

    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await buyer.get(`${API}/shops/${shopId}/admin`);

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('FORBIDDEN');
  });

  it('refuses an anonymous caller with UNAUTHENTICATED, distinct from a signed-in refusal', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const shopId = await createShop(app, communityId, OWNER_A);

    const response = await newClient(app).get(`${API}/shops/${shopId}/admin`);

    expect(response.status).toBe(401);
  });

  it(
    'answers the identical 403 for a shop in another community and a shop that does not exist ' +
      '— the guard must not become an oracle for which shop ids are real',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
      const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
      const shopB = await createShop(app, communityB, OWNER_B);

      const adminA = newClient(app);
      const adminASession = await registerAndLogin(adminA, ADMIN_A);
      const adminAId = (adminASession.body as { id: string }).id;
      await assignAdmin(superAdmin, communityA, adminAId);

      const missing = await adminA.get(`${API}/shops/${newId()}/admin`);
      const elsewhere = await adminA.get(`${API}/shops/${shopB}/admin`);

      expect(missing.status).toBe(elsewhere.status);
      expect(missing.status).toBe(403);
      expect((missing.body as ErrorBody).code).toBe((elsewhere.body as ErrorBody).code);
    },
  );

  it('refuses the very next request after the admin is revoked (invariant 7)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const shopId = await createShop(app, communityId, OWNER_A);

    const adminA = newClient(app);
    const adminASession = await registerAndLogin(adminA, ADMIN_A);
    const adminAId = (adminASession.body as { id: string }).id;
    await assignAdmin(superAdmin, communityId, adminAId);

    const before = await adminA.get(`${API}/shops/${shopId}/admin`);
    expect(before.status).toBe(200);

    await superAdmin
      .delete(`${API}/communities/${communityId}/admins/${adminAId}`)
      .set(CSRF_HEADER, await csrfToken(superAdmin));

    // Same cookie, same session — nothing about it changed. Only the CommunityAdmin row is gone,
    // and the guard reads that row fresh on every request rather than caching the answer.
    const after = await adminA.get(`${API}/shops/${shopId}/admin`);
    expect(after.status).toBe(403);
  });
});
