import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #34: `Shop` full — applying (B0.1's verified-email gate), the public list and single view
 * (invariant 1, only APPROVED and open shops), "1 คน = 1 ร้าน" enforced by a partial unique
 * index at the database (B2 · H12). Approval, payment channels, closing and suspension are
 * #35-#38's own tickets and are not tested here.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';
const BUYER = 'buyer@example.test';

interface MyShopBody {
  id: string;
  communityId: string;
  approvalStatus: string;
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

async function apply(client: Agent, communityId: string) {
  return client
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ communityId, name: 'ร้านทดสอบ' });
}

describe('applying to open a shop (B0.1)', () => {
  it('lets a verified account apply, answering PENDING', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);

    const response = await apply(seller, communityId);

    expect(response.status).toBe(201);
    const body = response.body as MyShopBody;
    expect(body.communityId).toBe(communityId);
    expect(body.approvalStatus).toBe('PENDING');
  });

  it('refuses an account with an unverified email', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerAndLogin(seller, SELLER);

    const response = await apply(seller, communityId);

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('refuses somebody not signed in at all', async () => {
    const response = await apply(newClient(getApp()), newId());

    expect(response.status).toBe(401);
  });

  it('answers 404 for a community that does not exist', async () => {
    const app = getApp();
    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);

    const response = await apply(seller, newId());

    expect(response.status).toBe(404);
  });
});

describe('one open shop per person, platform-wide (B2)', () => {
  it('refuses a second shop while the first is still open', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');

    const seller = newClient(app);
    const sellerId = await registerVerified(app, seller, SELLER);

    const first = await apply(seller, communityA);
    const second = await apply(seller, communityB);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect((second.body as ErrorBody).code).toBe('CONFLICT');
    await expect(
      app.prisma.shop.count({ where: { ownerId: sellerId, closedAt: null } }),
    ).resolves.toBe(1);
  });

  it(
    'enforces the one-open-shop rule at the database — two applications racing together ' +
      'produce exactly one 201',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

      const seller = newClient(app);
      const sellerId = await registerVerified(app, seller, SELLER);
      // Fetched once and reused on both concurrent requests — fetching a fresh token on each
      // would race the two calls against each other for the session's cookie jar, which is a
      // property of this test client and not of the endpoint under test.
      const token = await csrfToken(seller);

      const [a, b] = await Promise.all([
        seller.post(`${API}/shops`).set(CSRF_HEADER, token).send({ communityId, name: 'ร้านทดสอบ' }),
        seller.post(`${API}/shops`).set(CSRF_HEADER, token).send({ communityId, name: 'ร้านทดสอบ' }),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      await expect(
        app.prisma.shop.count({ where: { ownerId: sellerId, closedAt: null } }),
      ).resolves.toBe(1);
    },
  );
});

describe('the public shop list and single view — only APPROVED and open (invariant 1)', () => {
  it('hides a pending shop from the list', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    await apply(seller, communityId);

    const response = await newClient(app).get(`${API}/shops`);

    expect(response.status).toBe(200);
    const body = response.body as { items: { id: string }[] };
    expect(body.items).toHaveLength(0);
  });

  it('hides a pending shop from the single-shop view, the same as one that does not exist', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const created = await apply(seller, communityId);
    const shopId = (created.body as MyShopBody).id;

    const response = await newClient(app).get(`${API}/shops/${shopId}`);

    expect(response.status).toBe(404);
  });

  it('shows an approved shop in the list, filterable by communityId, with the owner’s disputeLostCount', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');

    const seller = newClient(app);
    const sellerId = await registerVerified(app, seller, SELLER);
    const created = await apply(seller, communityA);
    const shopId = (created.body as MyShopBody).id;
    await approveShop(app, shopId);
    // Arranged directly (#76 keeps it): two lost disputes through the real flow is two full
    // order-and-dispute cycles, and this test only reads the count back.
    await app.prisma.user.update({ where: { id: sellerId }, data: { disputeLostCount: 2 } });

    // No filter: nobody's browsing is scoped to a community (A1).
    const unfiltered = await newClient(app).get(`${API}/shops`);
    expect(unfiltered.status).toBe(200);
    const unfilteredBody = unfiltered.body as {
      items: { id: string; disputeLostCount: number }[];
    };
    expect(unfilteredBody.items.map((item) => item.id)).toContain(shopId);
    expect(unfilteredBody.items.find((item) => item.id === shopId)?.disputeLostCount).toBe(2);

    // Filtered to the shop's own community: found.
    const matching = await newClient(app).get(`${API}/shops`).query({ communityId: communityA });
    expect((matching.body as { items: { id: string }[] }).items.map((item) => item.id)).toContain(
      shopId,
    );

    // Filtered to the other community: not found.
    const notMatching = await newClient(app).get(`${API}/shops`).query({ communityId: communityB });
    expect(
      (notMatching.body as { items: { id: string }[] }).items.map((item) => item.id),
    ).not.toContain(shopId);
  });

  it('shows an approved shop on the public single-shop view, without ownerId', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const created = await apply(seller, communityId);
    const shopId = (created.body as MyShopBody).id;
    await approveShop(app, shopId);

    const response = await newClient(app).get(`${API}/shops/${shopId}`);

    expect(response.status).toBe(200);
    const body = response.body as { id: string; ownerId?: string };
    expect(body.id).toBe(shopId);
    expect(body.ownerId).toBeUndefined();
  });
});

describe('GET /shops/me — the one view that shows PENDING', () => {
  it('shows the caller their own pending shop', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    await apply(seller, communityId);

    const response = await seller.get(`${API}/shops/me`);

    expect(response.status).toBe(200);
    expect((response.body as MyShopBody).approvalStatus).toBe('PENDING');
  });

  it('answers 404 for a signed-in account with no shop', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await buyer.get(`${API}/shops/me`);

    expect(response.status).toBe(404);
  });

  it("does not show one seller's shop to another", async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    await apply(seller, communityId);

    const otherSeller = newClient(app);
    await registerVerified(app, otherSeller, OTHER_SELLER);

    const response = await otherSeller.get(`${API}/shops/me`);

    expect(response.status).toBe(404);
  });
});
