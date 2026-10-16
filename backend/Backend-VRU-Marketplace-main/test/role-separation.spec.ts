import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { registerVerified } from './helpers/arrange.js';
import { API, csrfToken } from './helpers/auth.js';
import { approveProduct, approveShopAs } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * §85 (N29): an account that holds admin power — a community admin or super admin — is kept apart
 * from an ordinary account: it can neither run a shop nor buy anything, and a person who still
 * runs a shop cannot be made a community admin until that shop is closed. The owner's own words:
 * "จะได้แยกไว้อย่างชัดเจนต่างจาก users ปกติ".
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';

interface ProductBody {
  id: string;
  variants: { id: string }[];
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerVerified(app, client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — the one column still written directly.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function createCommunity(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin.post(`${API}/communities`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ name, description: 'รายละเอียดสำหรับทดสอบ' });

  return (response.body as { id: string }).id;
}

async function assignAdmin(superAdmin: Agent, communityId: string, userId: string) {
  return superAdmin.post(`${API}/communities/${communityId}/admins`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ userId });
}

async function applyForShop(client: Agent, communityId: string) {
  return client.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(client)).send({ communityId, name: 'ร้านทดสอบ' });
}

async function addToCart(client: Agent, variantId: string) {
  return client.post(`${API}/cart/items`).set(CSRF_HEADER, await csrfToken(client)).send({ variantId, quantity: 1 });
}

/** A community with one approved shop selling one approved product. */
async function marketplace(app: TestApp): Promise<{ superAdmin: Agent; communityId: string; variantId: string }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const category = await superAdmin.post(`${API}/categories`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ name: 'เสื้อผ้า' });
  const seller = newClient(app);
  await registerVerified(app, seller, 'seller@example.test');
  const shop = await applyForShop(seller, communityId);
  await approveShopAs(superAdmin, (shop.body as { id: string }).id);
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ name: 'ของทดสอบ', description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId: (category.body as { id: string }).id, variants: [{ name: 'แบบเดียว', priceAmountMinor: 10000, stock: 5 }] });
  const productId = (created.body as { id: string }).id;
  await approveProduct(superAdmin, productId);
  const product = (await seller.get(`${API}/products/${productId}`)).body as ProductBody;

  return { superAdmin, communityId, variantId: product.variants[0]!.id };
}

describe('§85 (N29) — admins cannot run a shop', () => {
  it('a community admin applying to open a shop is refused', async () => {
    const app = getApp();
    const { superAdmin, communityId } = await marketplace(app);
    const admin = newClient(app);
    await assignAdmin(superAdmin, communityId, await registerVerified(app, admin, 'admin@example.test'));

    const response = await applyForShop(admin, communityId);

    expect(response.status).toBe(403);
  });

  it('a super admin applying to open a shop is refused', async () => {
    const app = getApp();
    const { superAdmin, communityId } = await marketplace(app);

    const response = await applyForShop(superAdmin, communityId);

    expect(response.status).toBe(403);
  });

  it('someone who still runs a shop cannot be made a community admin — only once that shop is closed', async () => {
    const app = getApp();
    const { superAdmin, communityId } = await marketplace(app);
    const owner = newClient(app);
    const ownerId = await registerVerified(app, owner, 'owner@example.test');
    const shopId = ((await applyForShop(owner, communityId)).body as { id: string }).id;
    await approveShopAs(superAdmin, shopId);

    const whileOpen = await assignAdmin(superAdmin, communityId, ownerId);
    expect(whileOpen.status).toBe(409);

    await owner.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(owner));
    const afterClosing = await assignAdmin(superAdmin, communityId, ownerId);
    expect(afterClosing.status).toBe(201);
  });
});

describe('§85 (N29) — admins cannot buy', () => {
  it('a community admin cannot add to the cart, nor check out a cart filled before they became one', async () => {
    const app = getApp();
    const { superAdmin, communityId, variantId } = await marketplace(app);
    const person = newClient(app);
    const personId = await registerVerified(app, person, 'person@example.test');
    expect((await addToCart(person, variantId)).status).toBe(200);
    await assignAdmin(superAdmin, communityId, personId);

    const added = await addToCart(person, variantId);
    const checkout = await checkoutAsShown(person, '01900000-0000-7000-8000-000000000000');

    expect(added.status).toBe(403);
    expect(checkout.status).toBe(403);
  });

  it('a super admin cannot add to the cart', async () => {
    const app = getApp();
    const { superAdmin, variantId } = await marketplace(app);

    const response = await addToCart(superAdmin, variantId);

    expect(response.status).toBe(403);
  });
});
