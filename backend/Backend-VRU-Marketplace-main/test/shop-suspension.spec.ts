import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveShopAs } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #38: suspending a shop — J2 ("ระงับ = ห้ามขายใหม่ ไม่ใช่ห้ามทำของค้าง") and the third layer of
 * visibility (I14): hidden from the list, but the direct link stays open with the status
 * still readable, never 404.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const SELLER = 'seller@example.test';
const OWNER_ADMIN = 'owner-admin@example.test';
const BUYER = 'buyer@example.test';

interface ShopBody {
  id: string;
  suspendedAt: string | null;
  closedAt: string | null;
}

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

async function applyAndApprove(
  superAdmin: Agent,
  seller: Agent,
  communityId: string,
): Promise<string> {
  const response = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (response.body as ShopBody).id;
  await approveShopAs(superAdmin, shopId);

  return shopId;
}

async function suspend(client: Agent, shopId: string, reason = 'เหตุผลสำหรับทดสอบการระงับร้าน') {
  return client
    .post(`${API}/shops/${shopId}/suspend`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function unsuspend(client: Agent, shopId: string) {
  return client.post(`${API}/shops/${shopId}/unsuspend`).set(CSRF_HEADER, await csrfToken(client));
}

describe('who may suspend or unsuspend (the guard from #32, same as approve/reject)', () => {
  it('lets the shop’s own community admin suspend and unsuspend it', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const admin = newClient(app);
    const adminSession = await registerAndLogin(admin, ADMIN_A);
    const adminId = (adminSession.body as { id: string }).id;
    await assignAdmin(superAdmin, communityId, adminId);

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyAndApprove(superAdmin, seller, communityId);

    const suspendResponse = await suspend(admin, shopId);
    expect(suspendResponse.status).toBe(200);
    expect((suspendResponse.body as ShopBody).suspendedAt).not.toBeNull();

    const suspendEntry = await app.prisma.auditLog.findFirst({
      where: { action: 'SHOP_SUSPENDED', targetId: shopId },
    });
    expect(suspendEntry?.actorUserId).toBe(adminId);
    expect(suspendEntry?.reason).not.toBeNull();
    // Code review (2026-09-22, §77): backfills the community_id §75 added to audit_log.
    expect(suspendEntry?.communityId).toBe(communityId);

    const unsuspendResponse = await unsuspend(admin, shopId);
    expect(unsuspendResponse.status).toBe(200);
    expect((unsuspendResponse.body as ShopBody).suspendedAt).toBeNull();

    const unsuspendEntry = await app.prisma.auditLog.findFirst({
      where: { action: 'SHOP_UNSUSPENDED', targetId: shopId },
    });
    expect(unsuspendEntry).not.toBeNull();
    expect(unsuspendEntry?.communityId).toBe(communityId);
  });

  it(
    'refuses community A’s admin suspending a shop in community B — the test CLAUDE.md ' +
      'requires',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
      const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');

      const adminA = newClient(app);
      const adminASession = await registerAndLogin(adminA, ADMIN_A);
      const adminAId = (adminASession.body as { id: string }).id;
      await assignAdmin(superAdmin, communityA, adminAId);

      const seller = newClient(app);
      await registerVerified(app, seller, SELLER);
      const shopInB = await applyAndApprove(superAdmin, seller, communityB);

      const response = await suspend(adminA, shopInB);

      expect(response.status).toBe(403);
      await expect(
        app.prisma.shop.findUnique({ where: { id: shopInB }, select: { suspendedAt: true } }),
      ).resolves.toEqual({ suspendedAt: null });
    },
  );

  it('lets a super admin suspend without any CommunityAdmin row', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyAndApprove(superAdmin, seller, communityId);

    const response = await suspend(superAdmin, shopId);

    expect(response.status).toBe(200);
  });

  it('refuses an ordinary signed-in user with no CommunityAdmin row anywhere', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyAndApprove(superAdmin, seller, communityId);

    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await suspend(buyer, shopId);

    expect(response.status).toBe(403);
  });

  it('refuses the shop’s own owner even when they administer that community too (extends N28)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    // Since N29 (§85) an admin cannot open a shop and a shop owner cannot be appointed a community
    // admin, so the only way left to be both is SUPER_ADMIN set in the database (it has no endpoint
    // by design) — the arrangement CLAUDE.md names for N28 tests. Before §91 this test appointed
    // first and applied second: the application was refused, the shop id was undefined, and the
    // 403s below came from a missing shop rather than from N28.
    const ownerAdmin = newClient(app);
    await registerVerified(app, ownerAdmin, OWNER_ADMIN);
    const shopId = await applyAndApprove(superAdmin, ownerAdmin, communityId);
    await app.prisma.user.update({ where: { email: OWNER_ADMIN }, data: { role: 'SUPER_ADMIN' } });

    const suspendResult = await suspend(ownerAdmin, shopId);
    expect(suspendResult.status).toBe(403);

    // Also refused lifting a suspension somebody else placed, for the same reason.
    await suspend(superAdmin, shopId);
    const unsuspendResult = await unsuspend(ownerAdmin, shopId);
    expect(unsuspendResult.status).toBe(403);
  });
});

describe('suspending requires a reason; unsuspending does not', () => {
  it('rejects a suspend reason that is too short with 400', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyAndApprove(superAdmin, seller, communityId);

    const response = await suspend(superAdmin, shopId, 'สั้น');

    expect(response.status).toBe(400);
  });

  it('answers 409 suspending an already-suspended shop, and 409 unsuspending one that is not', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyAndApprove(superAdmin, seller, communityId);

    const notSuspendedYet = await unsuspend(superAdmin, shopId);
    expect(notSuspendedYet.status).toBe(409);
    expect((notSuspendedYet.body as ErrorBody).code).toBe('CONFLICT');

    await suspend(superAdmin, shopId);
    const alreadySuspended = await suspend(superAdmin, shopId);
    expect(alreadySuspended.status).toBe(409);
  });
});

describe('J2: suspended means no new sales, not a lock on finishing what is already in progress', () => {
  it('a suspended shop cannot close itself', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyAndApprove(superAdmin, seller, communityId);
    await suspend(superAdmin, shopId);

    const response = await seller
      .post(`${API}/shops/${shopId}/close`)
      .set(CSRF_HEADER, await csrfToken(seller));

    expect(response.status).toBe(409);
  });

  // Everything else J2 lists as still-permitted while suspended (shipping, confirming payment,
  // refunding, answering a dispute, chatting) is an order or product action that does not exist
  // yet — topics 7, 8, 9 and 10 own testing that suspension does not block those, per this
  // ticket's own instruction not to write suspension as a blanket guard. Nothing in this file
  // checks suspension anywhere near such an action, which is what keeps that promise true today.
});

describe('the third layer of visibility (I14): hidden from the list, direct link stays open', () => {
  it('disappears from the public list but the direct link still answers 200 with suspendedAt set', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyAndApprove(superAdmin, seller, communityId);
    await suspend(superAdmin, shopId);

    const list = await newClient(app).get(`${API}/shops`).query({ communityId });
    expect((list.body as { items: { id: string }[] }).items.map((item) => item.id)).not.toContain(
      shopId,
    );

    const direct = await newClient(app).get(`${API}/shops/${shopId}`);
    expect(direct.status).toBe(200);
    const body = direct.body as ShopBody;
    expect(body.id).toBe(shopId);
    expect(body.suspendedAt).not.toBeNull();
  });
});
