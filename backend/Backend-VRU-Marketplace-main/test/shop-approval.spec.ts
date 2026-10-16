import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveShopAs, rejectShopAs } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #35: approving/rejecting shop applications — the two-tier guard's (#32) first real user.
 * A community admin acts only within their own community; a rejection carries a reason the
 * applicant can read; nobody, admin or super admin, approves their own shop (N28).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const SELLER = 'seller@example.test';
const OWNER_ADMIN = 'owner-admin@example.test';
const BUYER = 'buyer@example.test';

interface MyShopBody {
  id: string;
  approvalStatus: string;
  closedAt: string | null;
  rejectionReason: string | null;
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

async function applyForShop(client: Agent, communityId: string): Promise<string> {
  const response = await client
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ communityId, name: 'ร้านทดสอบ' });

  return (response.body as MyShopBody).id;
}

async function approve(client: Agent, shopId: string, seen?: number) {
  return approveShopAs(client, shopId, seen);
}

async function reject(client: Agent, shopId: string, reason: string, seen?: number) {
  return rejectShopAs(client, shopId, reason, seen);
}

describe('who may approve or reject (the guard from #32, for real)', () => {
  it('lets the shop’s own community admin approve it', async () => {
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
    const shopId = await applyForShop(seller, communityId);

    const response = await approve(admin, shopId);

    expect(response.status).toBe(200);
    expect((response.body as { approvalStatus: string }).approvalStatus).toBe('APPROVED');

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'SHOP_APPROVED', targetId: shopId },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorUserId).toBe(adminId);
    // Code review (2026-09-22, §77): backfills the community_id §75 added to audit_log — Shop
    // already carries its own communityId, so this shop's writer had no excuse to leave it null.
    expect(entry?.communityId).toBe(communityId);
  });

  it('refuses community A’s admin approving or rejecting a shop in community B', async () => {
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
    const shopInB = await applyForShop(seller, communityB);

    // §91: an admin of another community cannot open this shop's admin view, so there is no
    // revision to read — the guard must refuse before the revision matters.
    const approveResult = await approve(adminA, shopInB, 0);
    expect(approveResult.status).toBe(403);

    const rejectResult = await reject(adminA, shopInB, 'เหตุผลสำหรับทดสอบการปฏิเสธ', 0);
    expect(rejectResult.status).toBe(403);

    await expect(
      app.prisma.shop.findUnique({ where: { id: shopInB }, select: { approvalStatus: true } }),
    ).resolves.toEqual({ approvalStatus: 'PENDING' });
  });

  it('lets a super admin approve without any CommunityAdmin row', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyForShop(seller, communityId);

    const response = await approve(superAdmin, shopId);

    expect(response.status).toBe(200);
  });

  it('refuses an ordinary signed-in user with no CommunityAdmin row anywhere', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyForShop(seller, communityId);

    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await approve(buyer, shopId, 0);

    expect(response.status).toBe(403);
  });
});

describe('rejecting requires a reason the applicant can read, and lets them reapply', () => {
  it('rejects with a reason, and the applicant reads it on GET /shops/me', async () => {
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
    const shopId = await applyForShop(seller, communityId);

    const reason = 'ชื่อร้านซ้ำกับร้านอื่นในชุมชนเดียวกัน กรุณาเปลี่ยนชื่อแล้วยื่นใหม่';
    const response = await reject(admin, shopId, reason);

    expect(response.status).toBe(200);
    const body = response.body as { approvalStatus: string; rejectionReason: string };
    expect(body.approvalStatus).toBe('REJECTED');
    expect(body.rejectionReason).toBe(reason);

    const mine = await seller.get(`${API}/shops/me`);
    expect(mine.status).toBe(200);
    const mineBody = mine.body as MyShopBody;
    expect(mineBody.id).toBe(shopId);
    expect(mineBody.approvalStatus).toBe('REJECTED');
    expect(mineBody.rejectionReason).toBe(reason);

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'SHOP_REJECTED', targetId: shopId },
    });
    expect(entry?.reason).toBe(reason);
    expect(entry?.communityId).toBe(communityId);

    // Code review (2026-09-22, §77): rejection used to tell nobody — PRODUCT_REJECTED already
    // notified its applicant, and this closes the same gap for shops.
    const sellerId = (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).ownerId;
    const notification = await app.prisma.notification.findFirst({
      where: { userId: sellerId, type: 'SHOP_REJECTED' },
    });
    expect(notification).not.toBeNull();
    expect(notification?.message).toContain(reason);
  });

  it('rejects with a reason too short with 400, never reaching the guard’s decision', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyForShop(seller, communityId);

    const response = await reject(superAdmin, shopId, 'สั้นไป');

    expect(response.status).toBe(400);
  });

  it('lets a rejected applicant apply again — the rejection frees their one-shop slot', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const firstShopId = await applyForShop(seller, communityId);
    await reject(superAdmin, firstShopId, 'เหตุผลสำหรับทดสอบการปฏิเสธครั้งแรก');

    const secondApplication = await seller
      .post(`${API}/shops`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ communityId, name: 'ร้านทดสอบ' });

    expect(secondApplication.status).toBe(201);
    const secondShopId = (secondApplication.body as MyShopBody).id;
    expect(secondShopId).not.toBe(firstShopId);

    const mine = await seller.get(`${API}/shops/me`);
    expect((mine.body as MyShopBody).id).toBe(secondShopId);
    expect((mine.body as MyShopBody).approvalStatus).toBe('PENDING');
  });
});

describe('approving or rejecting an already-decided application', () => {
  it('answers 409 approving a shop that was already approved', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyForShop(seller, communityId);
    await approve(superAdmin, shopId);

    const response = await approve(superAdmin, shopId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });

  it(
    'answers 403 for a community admin approving a shop that does not exist — the guard (#32) ' +
      'refuses before this route’s own code ever runs, the same as a real cross-community shop',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

      const admin = newClient(app);
      const adminSession = await registerAndLogin(admin, ADMIN_A);
      const adminId = (adminSession.body as { id: string }).id;
      await assignAdmin(superAdmin, communityId, adminId);

      const response = await approve(admin, newId(), 0);

      expect(response.status).toBe(403);
    },
  );

  it(
    'answers a plain 404 for a super admin — the one caller the guard lets straight through ' +
      'without asking the resolver anything, so this route’s own NOT_FOUND is what answers',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);

      const response = await approve(superAdmin, newId(), 0);

      expect(response.status).toBe(404);
    },
  );
});

describe('a shop owner may not approve or reject their own application (N28)', () => {
  it('the owner-and-admin arrangement can no longer be built from the front: an admin cannot apply, an applicant cannot be made admin (§85, N29)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const admin = newClient(app);
    await assignAdmin(superAdmin, communityId, await registerVerified(app, admin, OWNER_ADMIN));
    const adminApplies = await admin.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(admin)).send({ communityId, name: 'ร้านทดสอบ' });
    expect(adminApplies.status).toBe(403);

    const applicant = newClient(app);
    const applicantId = await registerVerified(app, applicant, 'applicant@example.test');
    await applyForShop(applicant, communityId);
    const madeAdmin = await superAdmin
      .post(`${API}/communities/${communityId}/admins`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ userId: applicantId });
    expect(madeAdmin.status).toBe(409);
  });

  it('refuses an applicant later made super admin approving their own shop — N28 still covers the one route N29 cannot see', async () => {
    // A super admin is made by setting the role column in the database; nothing at that moment
    // checks for an open shop, so N28's own check is what still stands behind it.
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const owner = newClient(app);
    await registerVerified(app, owner, OWNER_ADMIN);
    const shopId = await applyForShop(owner, communityId);
    // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
    await app.prisma.user.update({ where: { email: OWNER_ADMIN }, data: { role: 'SUPER_ADMIN' } });

    const approveResult = await approve(owner, shopId);
    expect(approveResult.status).toBe(403);

    const rejectResult = await reject(owner, shopId, 'เหตุผลสำหรับทดสอบการปฏิเสธ');
    expect(rejectResult.status).toBe(403);

    await expect(
      app.prisma.shop.findUnique({ where: { id: shopId }, select: { approvalStatus: true } }),
    ).resolves.toEqual({ approvalStatus: 'PENDING' });
  });
});

describe('GET /shops/pending — scoped to the caller automatically', () => {
  it('shows a community admin only the pending applications of communities they administer', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');

    const adminA = newClient(app);
    const adminASession = await registerAndLogin(adminA, ADMIN_A);
    const adminAId = (adminASession.body as { id: string }).id;
    await assignAdmin(superAdmin, communityA, adminAId);

    const sellerA = newClient(app);
    await registerVerified(app, sellerA, SELLER);
    const shopA = await applyForShop(sellerA, communityA);

    const sellerB = newClient(app);
    await registerVerified(app, sellerB, OWNER_ADMIN);
    await applyForShop(sellerB, communityB);

    const response = await adminA.get(`${API}/shops/pending`);

    expect(response.status).toBe(200);
    const body = response.body as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toEqual([shopA]);
  });

  it('shows a super admin every pending application across every community', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');

    const sellerA = newClient(app);
    await registerVerified(app, sellerA, SELLER);
    await applyForShop(sellerA, communityA);

    const sellerB = newClient(app);
    await registerVerified(app, sellerB, OWNER_ADMIN);
    await applyForShop(sellerB, communityB);

    const response = await superAdmin.get(`${API}/shops/pending`);

    expect((response.body as { items: unknown[] }).items).toHaveLength(2);
  });

  it('answers an empty page, not 403, for a signed-in caller who administers nothing', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await buyer.get(`${API}/shops/pending`);

    expect(response.status).toBe(200);
    expect((response.body as { items: unknown[] }).items).toEqual([]);
  });
});
