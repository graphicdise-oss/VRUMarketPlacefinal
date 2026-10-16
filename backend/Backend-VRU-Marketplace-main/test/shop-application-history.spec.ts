import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct, approveShopAs } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * §97 (K16, owner's decision in §94): a person who lost disputes, erased their account and signed
 * up again with the same address may apply for a shop — but the admin reviewing the application
 * sees how many disputes the erased account lost. Read from `DeletedAccountMarker` by the new
 * account's address; never copied back onto the new account, and never shown to anyone else.
 * Next to it, the current account's own losses (owner's decision after the §97 review), so an
 * owner reapplying on the same account (H12) is not shown a clean 0 either.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const ADMIN_B = 'admin-b@example.test';
const SELLER = 'seller@example.test';
const STRANGER = 'stranger@example.test';

interface ShopAdminBody {
  id: string;
  ownerDisputeLostCount: number;
  ownerPriorDisputeLostCount: number;
}

async function post(client: Agent, path: string, body: Record<string, unknown> = {}) {
  return client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function communityWithAdmin(app: TestApp, superAdmin: Agent, name: string, adminEmail: string): Promise<{ communityId: string; admin: Agent }> {
  const communityId = ((await post(superAdmin, '/communities', { name, description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const admin = newClient(app);
  const adminId = await registerVerified(app, admin, adminEmail);
  expect((await post(superAdmin, `/communities/${communityId}/admins`, { userId: adminId })).status).toBe(201);
  return { communityId, admin };
}

async function applyForShop(client: Agent, communityId: string, name: string): Promise<string> {
  const applied = await post(client, '/shops', { communityId, name });
  expect(applied.status).toBe(201);
  return (applied.body as { id: string }).id;
}

/** Checks every arrange step, so a broken one fails here rather than somewhere unrelated later. */
async function ok<T extends { status: number }>(response: Promise<T>, expected: number): Promise<T> {
  const settled = await response;
  expect(settled.status).toBe(expected);
  return settled;
}

/**
 * The seller's account runs a shop and loses one dispute (BUYER_WINS), then refunds the buyer —
 * every step through its real door. Returns the seller, still signed in, and the shop (still open).
 */
async function runShopAndLoseADispute(
  app: TestApp,
  superAdmin: Agent,
  communityAdmin: Agent,
  { communityId, categoryId, buyerEmail }: { communityId: string; categoryId: string; buyerEmail: string },
): Promise<{ seller: Agent; shopId: string }> {
  const seller = newClient(app);
  await registerVerified(app, seller, SELLER);
  const shopId = await applyForShop(seller, communityId, 'ร้านเดิม');
  await approveShop(app, shopId);
  const productId = ((await ok(post(seller, '/products', {
    name: 'เสื้อยืดผ้าฝ้าย',
    description: 'คำอธิบายสินค้าสำหรับทดสอบ',
    categoryId,
    variants: [{ name: 'ไซส์ M', priceAmountMinor: 10000, stock: 5 }],
  }), 201)).body as { id: string }).id;
  await ok(approveProduct(superAdmin, productId), 200);
  const variantId = ((await seller.get(`${API}/products/${productId}`)).body as { variants: { id: string }[] }).variants[0]!.id;

  const buyer = newClient(app);
  await registerVerified(app, buyer, buyerEmail);
  const subdistrictPostalCodeId = (await app.prisma.subdistrictPostalCode.findFirstOrThrow()).id; // seed data, read-only
  const addressId = ((await ok(post(buyer, '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId }), 201)).body as { id: string }).id;
  await ok(post(buyer, '/cart/items', { variantId, quantity: 1 }), 200);
  const orderId = ((await ok(checkoutAsShown(buyer, addressId), 201)).body as { id: string }[])[0]!.id;
  await ok(post(seller, `/shops/me/orders/${orderId}/shipping-fee`, { shippingAmountMinor: 2000 }), 200);
  await ok(buyer.post(`${API}/orders/${orderId}/payment-slips`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await aJpegBuffer(), 'slip.jpg'), 201);
  const dispute = (await ok(
    buyer
      .post(`${API}/orders/${orderId}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'โอนเงินแล้วแต่ร้านไม่ยอมยืนยัน ไม่ตอบแชทเลย')
      .attach('files', await aJpegBuffer(), 'evidence.jpg'),
    201,
  )).body as { id: string };
  await ok(post(communityAdmin, `/disputes/${dispute.id}/ruling`, { verdict: 'BUYER_WINS', reason: 'ร้านไม่ตอบและไม่ยืนยันเงินเข้า ตามหลักฐานผู้ซื้อโอนครบแล้ว' }), 200);

  await ok(post(buyer, `/orders/${orderId}/refund-account`, { type: 'PROMPTPAY', promptPayId: '0899999999' }), 200);
  await ok(seller.post(`${API}/shops/me/orders/${orderId}/refund-slips`).set(CSRF_HEADER, await csrfToken(seller)).attach('file', await aJpegBuffer(), 'refund.jpg'), 201);
  await ok(post(buyer, `/orders/${orderId}/refund-received`), 200);
  return { seller, shopId };
}

/** As above, then the shop closes and the account erases itself (never banned). */
async function sellerWhoLostADisputeThenErased(
  app: TestApp,
  superAdmin: Agent,
  communityAdmin: Agent,
  where: { communityId: string; categoryId: string; buyerEmail: string },
): Promise<void> {
  const { seller, shopId } = await runShopAndLoseADispute(app, superAdmin, communityAdmin, where);
  await ok(post(seller, `/shops/${shopId}/close`), 200);
  await ok(post(seller, '/auth/account/erase'), 204);
}

async function newCategory(superAdmin: Agent): Promise<string> {
  return ((await ok(post(superAdmin, '/categories', { name: 'เสื้อผ้า' }), 201)).body as { id: string }).id;
}

/** A community with its admin, and SELLER back under a fresh account after losing one dispute and erasing. */
async function returningApplicant(app: TestApp) {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const { communityId, admin: adminA } = await communityWithAdmin(app, superAdmin, 'ชุมชนบางแสน', ADMIN_A);
  await sellerWhoLostADisputeThenErased(app, superAdmin, adminA, { communityId, categoryId: await newCategory(superAdmin), buyerEmail: 'buyer-1@example.test' });
  const returning = newClient(app);
  await registerVerified(app, returning, SELLER); // never banned → K16 lets the address sign up again
  const shopId = await applyForShop(returning, communityId, 'ร้านใหม่');
  return { superAdmin, adminA, communityId, shopId };
}

async function adminView(reviewer: Agent, shopId: string): Promise<ShopAdminBody> {
  return (await ok(reviewer.get(`${API}/shops/${shopId}/admin`), 200)).body as ShopAdminBody;
}

describe('§97 (K16) — the admin reviewing a shop application sees the disputes an erased earlier account lost', () => {
  it('a re-registered seller’s application shows the old account’s losses to its community admin and a super admin — in the queue and on the admin view', async () => {
    const app = getApp();
    const { superAdmin, adminA, shopId } = await returningApplicant(app);

    for (const reviewer of [adminA, superAdmin]) {
      expect(await adminView(reviewer, shopId)).toMatchObject({ ownerPriorDisputeLostCount: 1, ownerDisputeLostCount: 0 });
      const queue = (await reviewer.get(`${API}/shops/pending`)).body as { items: ShopAdminBody[] };
      expect(queue.items.find((item) => item.id === shopId)).toMatchObject({ ownerPriorDisputeLostCount: 1, ownerDisputeLostCount: 0 });
    }
  });

  it('adds up the losses of every erased account behind the address', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const { communityId, admin: adminA } = await communityWithAdmin(app, superAdmin, 'ชุมชนบางแสน', ADMIN_A);
    const categoryId = await newCategory(superAdmin);
    await sellerWhoLostADisputeThenErased(app, superAdmin, adminA, { communityId, categoryId, buyerEmail: 'buyer-1@example.test' });
    await sellerWhoLostADisputeThenErased(app, superAdmin, adminA, { communityId, categoryId, buyerEmail: 'buyer-2@example.test' });
    const third = newClient(app);
    await registerVerified(app, third, SELLER);

    const shopId = await applyForShop(third, communityId, 'ร้านที่สาม');

    expect((await adminView(adminA, shopId)).ownerPriorDisputeLostCount).toBe(2);
  });

  it('shows the current account’s own losses when an owner reapplies on the same account after closing their shop (H12)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const { communityId, admin: adminA } = await communityWithAdmin(app, superAdmin, 'ชุมชนบางแสน', ADMIN_A);
    const { seller, shopId: firstShop } = await runShopAndLoseADispute(app, superAdmin, adminA, { communityId, categoryId: await newCategory(superAdmin), buyerEmail: 'buyer-1@example.test' });
    await ok(post(seller, `/shops/${firstShop}/close`), 200);

    const shopId = await applyForShop(seller, communityId, 'ร้านเปิดใหม่');

    expect(await adminView(adminA, shopId)).toMatchObject({ ownerDisputeLostCount: 1, ownerPriorDisputeLostCount: 0 });
  });

  it('is never copied onto the new account: the public shop page shows the new account’s own count, and nothing about the old one', async () => {
    const app = getApp();
    const { adminA, shopId } = await returningApplicant(app);
    await ok(approveShopAs(adminA, shopId), 200);

    const publicView = (await newClient(app).get(`${API}/shops/${shopId}`)).body as Record<string, unknown>;

    expect(publicView.disputeLostCount).toBe(0);
    expect(publicView).not.toHaveProperty('ownerPriorDisputeLostCount');
  });

  it('shows 0 for an applicant with no erased account behind their address', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const { communityId } = await communityWithAdmin(app, superAdmin, 'ชุมชนบางแสน', ADMIN_A);
    const stranger = newClient(app);
    await registerVerified(app, stranger, STRANGER);
    const shopId = await applyForShop(stranger, communityId, 'ร้านคนใหม่');

    expect((await adminView(superAdmin, shopId)).ownerPriorDisputeLostCount).toBe(0);
  });

  it('shows the same 0 for an erased earlier account that lost nothing — whether one existed is not revealed', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const { communityId } = await communityWithAdmin(app, superAdmin, 'ชุมชนบางแสน', ADMIN_A);
    const first = newClient(app);
    await registerVerified(app, first, SELLER);
    await ok(post(first, '/auth/account/erase'), 204);
    const returning = newClient(app);
    await registerVerified(app, returning, SELLER);

    const shopId = await applyForShop(returning, communityId, 'ร้านใหม่');

    expect((await adminView(superAdmin, shopId)).ownerPriorDisputeLostCount).toBe(0);
  });

  it('an admin of community B cannot see the application of a shop in community A at all', async () => {
    const app = getApp();
    const { superAdmin, shopId } = await returningApplicant(app);
    const { admin: adminB } = await communityWithAdmin(app, superAdmin, 'ชุมชนอ่างศิลา', ADMIN_B);

    const view = await adminB.get(`${API}/shops/${shopId}/admin`);

    expect(view.status).toBe(403);
    expect(view.body).not.toHaveProperty('ownerPriorDisputeLostCount');
    const queue = (await adminB.get(`${API}/shops/pending`)).body as { items: ShopAdminBody[] };
    expect(queue.items.map((item) => item.id)).not.toContain(shopId);
  });
});
