import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #42: invariant 6's three visibility layers combined at one point, and the only place a
 * stranger ever sees a product — the public list and single-product view. Approval (#43) and
 * editing (#44) are not tested here; a product's `moderationStatus` is set directly in the
 * database, the same way `shop.spec.ts`'s `approveDirectly` arranges an APPROVED shop ahead of
 * #35's own tests for it.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';

interface PublicProductBody {
  id: string;
  shopId: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
  images: { id: string }[];
  shopClosedAt: string | null;
  shopSuspendedAt: string | null;
}
interface ProductBody {
  id: string;
  moderationStatus: string;
  shopPublishStatus: string;
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

async function createCategory(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin
    .post(`${API}/categories`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name });

  return (response.body as { id: string }).id;
}

async function sellerWithShop(app: TestApp, email: string, communityId: string): Promise<{ client: Agent; shopId: string }> {
  const seller = newClient(app);
  await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return { client: seller, shopId };
}

/** A product that passes every visibility layer — the common starting point most tests need. */
async function anApprovedProduct(
  app: TestApp,
  seller: Agent,
  categoryId: string,
): Promise<string> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name: 'เสื้อยืดลายชุมชน',
      description: 'ผ้าคอตตอน 100%',
      categoryId,
      variants: [{ name: 'ไซส์ M', priceAmountMinor: 15000, stock: 10 }],
    });
  const productId = (created.body as ProductBody).id;
  await app.prisma.product.update({ where: { id: productId }, data: { moderationStatus: 'APPROVED' } });

  return productId;
}

async function publish(client: Agent, productId: string) {
  return client.post(`${API}/products/${productId}/publish`).set(CSRF_HEADER, await csrfToken(client)).send();
}

async function unpublish(client: Agent, productId: string) {
  return client.post(`${API}/products/${productId}/unpublish`).set(CSRF_HEADER, await csrfToken(client)).send();
}

describe('the public product list — invariant 6’s three layers combined (#42)', () => {
  it('lets an anonymous caller list products', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProduct(app, seller, categoryId);

    const response = await newClient(app).get(`${API}/products`);

    expect(response.status).toBe(200);
    const body = response.body as { items: PublicProductBody[] };
    expect(body.items.some((item) => item.id === productId)).toBe(true);
  });

  it('hides a product still pending moderation', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const created = await seller
      .post(`${API}/products`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({
        name: 'สินค้ารอตรวจ',
        description: 'คำอธิบาย',
        categoryId,
        variants: [{ name: 'แบบเดียว', priceAmountMinor: 1000, stock: 5 }],
      });
    const productId = (created.body as ProductBody).id;

    const list = await newClient(app).get(`${API}/products`);
    expect((list.body as { items: PublicProductBody[] }).items.some((item) => item.id === productId)).toBe(false);

    const single = await newClient(app).get(`${API}/products/${productId}`);
    expect(single.status).toBe(404);
  });

  it('hides a product the shop unpublished, from both the list and the direct link', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProduct(app, seller, categoryId);

    const unpublishResponse = await unpublish(seller, productId);
    expect(unpublishResponse.status).toBe(200);
    expect((unpublishResponse.body as ProductBody).shopPublishStatus).toBe('UNPUBLISHED');

    const list = await newClient(app).get(`${API}/products`);
    expect((list.body as { items: PublicProductBody[] }).items.some((item) => item.id === productId)).toBe(false);

    const single = await newClient(app).get(`${API}/products/${productId}`);
    expect(single.status).toBe(404);
  });

  it('re-shows a product once published again', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProduct(app, seller, categoryId);
    await unpublish(seller, productId);

    const response = await publish(seller, productId);
    expect(response.status).toBe(200);
    expect((response.body as ProductBody).shopPublishStatus).toBe('PUBLISHED');

    const list = await newClient(app).get(`${API}/products`);
    expect((list.body as { items: PublicProductBody[] }).items.some((item) => item.id === productId)).toBe(true);
  });

  it('answers 409 publishing an already-published product, and unpublishing an already-hidden one', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProduct(app, seller, categoryId);

    const alreadyPublished = await publish(seller, productId);
    expect(alreadyPublished.status).toBe(409);

    await unpublish(seller, productId);
    const alreadyUnpublished = await unpublish(seller, productId);
    expect(alreadyUnpublished.status).toBe(409);
  });

  it('answers 404 for another seller trying to publish/unpublish a product that is not theirs', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityA);
    const productId = await anApprovedProduct(app, seller, categoryId);
    const { client: otherSeller } = await sellerWithShop(app, OTHER_SELLER, communityB);

    const response = await unpublish(otherSeller, productId);

    expect(response.status).toBe(404);
  });

  it(
    'hides a suspended shop’s products from the list, but its direct product link still ' +
      'answers 200 with shopSuspendedAt set (I14 — not a 404)',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
      const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
      const { client: seller, shopId } = await sellerWithShop(app, SELLER, communityId);
      const productId = await anApprovedProduct(app, seller, categoryId);
      await suspendShop(app, shopId);

      const list = await newClient(app).get(`${API}/products`);
      expect((list.body as { items: PublicProductBody[] }).items.some((item) => item.id === productId)).toBe(false);

      const single = await newClient(app).get(`${API}/products/${productId}`);
      expect(single.status).toBe(200);
      expect((single.body as PublicProductBody).shopSuspendedAt).not.toBeNull();
    },
  );

  it('hides a closed shop’s products from the list, but the direct link still answers 200', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProduct(app, seller, categoryId);
    await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller)).expect(200);

    const list = await newClient(app).get(`${API}/products`);
    expect((list.body as { items: PublicProductBody[] }).items.some((item) => item.id === productId)).toBe(false);

    const single = await newClient(app).get(`${API}/products/${productId}`);
    expect(single.status).toBe(200);
    expect((single.body as PublicProductBody).shopClosedAt).not.toBeNull();
  });

  it('hides a soft-deleted product from both the list and the direct link', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProduct(app, seller, categoryId);
    await app.prisma.product.update({ where: { id: productId }, data: { deletedAt: app.clock.now() } });

    const list = await newClient(app).get(`${API}/products`);
    expect((list.body as { items: PublicProductBody[] }).items.some((item) => item.id === productId)).toBe(false);

    const single = await newClient(app).get(`${API}/products/${productId}`);
    expect(single.status).toBe(404);
  });

  it('filters by communityId, and shows every community when it is omitted', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: sellerA } = await sellerWithShop(app, SELLER, communityA);
    const { client: sellerB } = await sellerWithShop(app, OTHER_SELLER, communityB);
    const productA = await anApprovedProduct(app, sellerA, categoryId);
    const productB = await anApprovedProduct(app, sellerB, categoryId);

    const filtered = await newClient(app).get(`${API}/products`).query({ communityId: communityA });
    const filteredIds = (filtered.body as { items: PublicProductBody[] }).items.map((item) => item.id);
    expect(filteredIds).toContain(productA);
    expect(filteredIds).not.toContain(productB);

    const unfiltered = await newClient(app).get(`${API}/products`);
    const unfilteredIds = (unfiltered.body as { items: PublicProductBody[] }).items.map((item) => item.id);
    expect(unfilteredIds).toContain(productA);
    expect(unfilteredIds).toContain(productB);
  });

  it('shows each variant’s price and stock on the public view', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProduct(app, seller, categoryId);

    const response = await newClient(app).get(`${API}/products/${productId}`);

    expect(response.status).toBe(200);
    const body = response.body as PublicProductBody;
    expect(body.variants[0]?.priceAmountMinor).toBe(15000);
    expect(body.variants[0]?.stock).toBe(10);
  });
});
