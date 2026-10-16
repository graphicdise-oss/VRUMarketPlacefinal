import sharp from 'sharp';
import type { Agent } from 'supertest';
import { vi } from 'vitest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import type { ErrorBody } from '../src/common/errors/error-payload.js';
import { StockReservationService } from '../src/order/services/stock-reservation.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';
import { beforeNextTransaction, untilSomeoneWaitsOnALock } from './helpers/interleave.js';

/**
 * §92 (owner's decision, 2026-09-28): a banned seller's shop stops selling — it leaves the shop
 * list, the product list and search, and takes no new orders — the way a suspended shop does
 * (invariant 6's third layer). Its direct links keep answering with the same "ร้านนี้ถูกระงับชั่วคราว"
 * badge a suspended shop shows, so an old order's page does not break (I14), and nothing outside
 * says the owner's *account* was banned. Lifting the ban brings it all back: nothing is stored on
 * the shop, the rule reads the owner's live flag.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const REASON = 'ขายสินค้าผิดกฎหมายตามที่มีผู้ร้องเรียนหลายราย';
const PRODUCT_NAME = 'ขนมชั้นใบเตย';

async function post(client: Agent, path: string, body?: object) {
  const request = client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client));
  return body === undefined ? request : request.send(body);
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

/** A super admin, an approved shop with one approved product, and a verified buyer. */
async function marketplace(app: TestApp) {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const categoryId = ((await post(superAdmin, '/categories', { name: 'ขนมไทย' })).body as { id: string }).id;
  const seller = newClient(app);
  const sellerId = await registerVerified(app, seller, SELLER);
  const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
  await approveShop(app, shopId);
  const { productId, variantId } = await listProduct(superAdmin, seller, categoryId);
  const buyer = newClient(app);
  const buyerId = await registerVerified(app, buyer, BUYER);

  return { superAdmin, communityId, categoryId, seller, sellerId, shopId, productId, variantId, buyer, buyerId };
}

async function listProduct(superAdmin: Agent, seller: Agent, categoryId: string) {
  const created = await post(seller, '/products', {
    name: PRODUCT_NAME,
    description: 'คำอธิบายสินค้าสำหรับทดสอบ',
    categoryId,
    variants: [{ name: 'กล่องเล็ก', priceAmountMinor: 10000, stock: 5 }],
  });
  const product = created.body as { id: string; variants: { id: string }[] };
  await approveProduct(superAdmin, product.id);

  return { productId: product.id, variantId: product.variants[0]!.id };
}

async function addressId(app: TestApp, buyer: Agent): Promise<string> {
  const spc = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  const address = await post(buyer, '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId: spc.id });

  return (address.body as { id: string }).id;
}

const ban = (superAdmin: Agent, userId: string) => post(superAdmin, `/admin/users/${userId}/ban`, { reason: REASON });
const unban = (superAdmin: Agent, userId: string) => post(superAdmin, `/admin/users/${userId}/unban`);

async function listedShopIds(client: Agent): Promise<string[]> {
  return ((await client.get(`${API}/shops`)).body as { items: { id: string }[] }).items.map((shop) => shop.id);
}

async function listedProductIds(client: Agent): Promise<string[]> {
  return ((await client.get(`${API}/products`)).body as { items: { id: string }[] }).items.map((product) => product.id);
}

/** The buyer's own order list, as their orders page reads it — `displayStatus` folds in `frozenAt`. */
async function ordersOf(buyer: Agent): Promise<{ id: string; displayStatus: string }[]> {
  return ((await buyer.get(`${API}/orders`)).body as { items: { id: string; displayStatus: string }[] }).items;
}

async function displayStatusOf(buyer: Agent, orderId: string): Promise<string> {
  return ((await buyer.get(`${API}/orders/${orderId}`)).body as { displayStatus: string }).displayStatus;
}

async function foundProductIds(client: Agent): Promise<string[]> {
  return ((await client.get(`${API}/products/search`).query({ q: 'ขนมชั้น' })).body as { items: { id: string }[] }).items.map((product) => product.id);
}

describe('§92 — a banned seller’s shop leaves every list', () => {
  it('drops out of the shop list, the product list and search, and comes back when the ban is lifted', async () => {
    const app = getApp();
    const { superAdmin, sellerId, shopId, productId } = await marketplace(app);
    const stranger = newClient(app);
    expect(await listedShopIds(stranger)).toEqual([shopId]);
    expect(await listedProductIds(stranger)).toEqual([productId]);
    expect(await foundProductIds(stranger)).toEqual([productId]);

    expect((await ban(superAdmin, sellerId)).status).toBe(204);

    expect(await listedShopIds(stranger)).toEqual([]);
    expect(await listedProductIds(stranger)).toEqual([]);
    expect(await foundProductIds(stranger)).toEqual([]);

    expect((await unban(superAdmin, sellerId)).status).toBe(204);

    expect(await listedShopIds(stranger)).toEqual([shopId]);
    expect(await listedProductIds(stranger)).toEqual([productId]);
    expect(await foundProductIds(stranger)).toEqual([productId]);
  });

  it('banning a buyer who owns no shop hides nothing', async () => {
    const app = getApp();
    const { superAdmin, buyerId, shopId, productId } = await marketplace(app);

    expect((await ban(superAdmin, buyerId)).status).toBe(204);

    const stranger = newClient(app);
    expect(await listedShopIds(stranger)).toEqual([shopId]);
    expect(await listedProductIds(stranger)).toEqual([productId]);
  });
});

describe('§92 — its direct links keep answering, with the suspended badge', () => {
  it('the shop and product pages answer 200 with suspendedAt set — the same badge a suspension shows — and clear on unban', async () => {
    const app = getApp();
    const { superAdmin, sellerId, shopId, productId } = await marketplace(app);
    const stranger = newClient(app);

    await ban(superAdmin, sellerId);

    const shop = await stranger.get(`${API}/shops/${shopId}`);
    expect(shop.status).toBe(200);
    expect((shop.body as { suspendedAt: string | null }).suspendedAt).not.toBeNull();
    expect(shop.body).not.toHaveProperty('ownerBannedAt');
    const product = await stranger.get(`${API}/products/${productId}`);
    expect(product.status).toBe(200);
    expect((product.body as { shopSuspendedAt: string | null }).shopSuspendedAt).not.toBeNull();

    await unban(superAdmin, sellerId);

    expect(((await stranger.get(`${API}/shops/${shopId}`)).body as { suspendedAt: string | null }).suspendedAt).toBeNull();
    expect(((await stranger.get(`${API}/products/${productId}`)).body as { shopSuspendedAt: string | null }).shopSuspendedAt).toBeNull();
  });

  it('the admin view still tells a ban and a suspension apart: the shop itself is not suspended', async () => {
    const app = getApp();
    const { superAdmin, sellerId, shopId } = await marketplace(app);

    await ban(superAdmin, sellerId);

    const admin = await superAdmin.get(`${API}/shops/${shopId}/admin`);
    expect(admin.status).toBe(200);
    expect((admin.body as { suspendedAt: string | null }).suspendedAt).toBeNull();
    // Unsuspending a shop that was never suspended is still refused — the ban is not a suspension.
    expect((await post(superAdmin, `/shops/${shopId}/unsuspend`)).status).toBe(409);
  });
});

describe('§93 — the admin view says why the shop left the lists', () => {
  it('the community’s own admin sees ownerBannedAt on the shop, on the suspend answer, and cleared on unban', async () => {
    const app = getApp();
    const { superAdmin, communityId, sellerId, shopId } = await marketplace(app);
    const communityAdmin = newClient(app);
    const communityAdminId = await registerVerified(app, communityAdmin, 'community-admin@example.test');
    expect((await post(superAdmin, `/communities/${communityId}/admins`, { userId: communityAdminId })).status).toBeLessThan(300);
    expect(((await communityAdmin.get(`${API}/shops/${shopId}/admin`)).body as { ownerBannedAt?: string | null }).ownerBannedAt).toBeNull();

    await ban(superAdmin, sellerId);

    const view = (await communityAdmin.get(`${API}/shops/${shopId}/admin`)).body as { ownerBannedAt?: string | null; suspendedAt: string | null };
    expect(view.ownerBannedAt).toEqual(expect.any(String));
    expect(view.suspendedAt).toBeNull();
    const suspended = await post(communityAdmin, `/shops/${shopId}/suspend`, { reason: REASON });
    expect(suspended.status).toBe(200);
    expect((suspended.body as { ownerBannedAt?: string | null }).ownerBannedAt).toEqual(expect.any(String));

    await unban(superAdmin, sellerId);

    expect(((await communityAdmin.get(`${API}/shops/${shopId}/admin`)).body as { ownerBannedAt?: string | null }).ownerBannedAt).toBeNull();
  });

  it('the pending queue shows it for an applicant banned while waiting', async () => {
    const app = getApp();
    const { superAdmin, communityId } = await marketplace(app);
    const applicant = newClient(app);
    const applicantId = await registerVerified(app, applicant, 'applicant@example.test');
    const pendingShopId = ((await post(applicant, '/shops', { communityId, name: 'ร้านรอตรวจ' })).body as { id: string }).id;

    await ban(superAdmin, applicantId);

    const queue = (await superAdmin.get(`${API}/shops/pending`)).body as { items: { id: string; ownerBannedAt?: string | null }[] };
    expect(queue.items.find((item) => item.id === pendingShopId)?.ownerBannedAt).toEqual(expect.any(String));
  });

  it('community A’s admin cannot open community B’s shop admin view at all — the field goes no further than the guard allows', async () => {
    const app = getApp();
    const { superAdmin, sellerId, shopId } = await marketplace(app);
    const otherCommunityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนศรีราชา', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
    const otherAdmin = newClient(app);
    const otherAdminId = await registerVerified(app, otherAdmin, 'other-admin@example.test');
    // Asserted, so the 403 below comes from the community boundary and not from an admin who was never appointed.
    expect((await post(superAdmin, `/communities/${otherCommunityId}/admins`, { userId: otherAdminId })).status).toBeLessThan(300);
    await ban(superAdmin, sellerId);

    const view = await otherAdmin.get(`${API}/shops/${shopId}/admin`);

    expect(view.status).toBe(403);
    expect(view.body).not.toHaveProperty('ownerBannedAt');
  });

  it('the public view never carries it', async () => {
    const app = getApp();
    const { superAdmin, sellerId, shopId } = await marketplace(app);
    await ban(superAdmin, sellerId);

    expect((await newClient(app).get(`${API}/shops/${shopId}`)).body).not.toHaveProperty('ownerBannedAt');
  });
});

describe('§92 — it takes no new orders', () => {
  it('its items show as not orderable in a cart, and checking out is refused with nothing created', async () => {
    const app = getApp();
    const { superAdmin, sellerId, variantId, buyer } = await marketplace(app);
    const address = await addressId(app, buyer);
    await post(buyer, '/cart/items', { variantId, quantity: 1 });

    await ban(superAdmin, sellerId);

    const cart = (await buyer.get(`${API}/cart`)).body as { items: { orderable: boolean }[]; orderCount: number };
    expect(cart.items.map((item) => item.orderable)).toEqual([false]);
    expect(cart.orderCount).toBe(0);
    const placed = await checkoutAsShown(buyer, address);
    expect(placed.status).toBe(409);
    expect(await ordersOf(buyer)).toEqual([]);

    await unban(superAdmin, sellerId);
    expect((await checkoutAsShown(buyer, address)).status).toBe(201);
  });

  it('a seller banned between reading the cart and placing the order: the order is refused', async () => {
    const app = getApp();
    const { superAdmin, sellerId, variantId, buyer } = await marketplace(app);
    const address = await addressId(app, buyer);
    await post(buyer, '/cart/items', { variantId, quantity: 1 });
    let banned = 0;
    beforeNextTransaction(app, async () => {
      banned = (await ban(superAdmin, sellerId)).status;
    });

    const placed = await checkoutAsShown(buyer, address);

    expect(banned).toBe(204);
    expect(placed.status).toBe(409);
    expect(await ordersOf(buyer)).toEqual([]);
  });

  it('a ban that arrives while a checkout holds its locks waits, then freezes the new order', async () => {
    const app = getApp();
    const { superAdmin, sellerId, variantId, buyer } = await marketplace(app);
    const address = await addressId(app, buyer);
    await post(buyer, '/cart/items', { variantId, quantity: 1 });
    const reservations = app.app.get(StockReservationService);
    const original = reservations.checkAndLock.bind(reservations);
    let banning: Promise<number> | undefined;
    vi.spyOn(reservations, 'checkAndLock').mockImplementationOnce(async (...args) => {
      // Not awaited: the ban has to queue behind the lock this checkout now holds on the seller.
      banning = ban(superAdmin, sellerId).then((response) => response.status);
      await untilSomeoneWaitsOnALock(app);
      return original(...args);
    });

    const placed = await checkoutAsShown(buyer, address);
    const banned = await banning;

    expect(placed.status).toBe(201);
    expect(banned).toBe(204);
    expect((await ordersOf(buyer)).map((order) => order.displayStatus)).toEqual(['FROZEN']);
  });

  it('the seller’s other lines in the same cart do not ride along: the whole checkout is refused', async () => {
    const app = getApp();
    const { superAdmin, communityId, categoryId, sellerId, variantId, buyer } = await marketplace(app);
    const secondSeller = newClient(app);
    await registerVerified(app, secondSeller, 'second-seller@example.test');
    const secondShopId = ((await post(secondSeller, '/shops', { communityId, name: 'ร้านข้าวหลามป้าศรี' })).body as { id: string }).id;
    await approveShop(app, secondShopId);
    const second = await listProduct(superAdmin, secondSeller, categoryId);
    const address = await addressId(app, buyer);
    await post(buyer, '/cart/items', { variantId, quantity: 1 });
    await post(buyer, '/cart/items', { variantId: second.variantId, quantity: 1 });
    beforeNextTransaction(app, async () => {
      await ban(superAdmin, sellerId);
    });

    const placed = await checkoutAsShown(buyer, address);

    // No half orders (K8's rule, §91's requireStillOrderable): the buyer re-reads the cart — STALE_VIEW
    // since §111, the same answer as a change caught before the locks.
    expect(placed.status).toBe(409);
    expect((placed.body as ErrorBody).code).toBe('STALE_VIEW');
    expect(await ordersOf(buyer)).toEqual([]);
  });
});

describe('§92 — banning a seller who closed a shop before opening this one', () => {
  it('freezes the orders of every shop they own — the open one, and a closed one still shipping — and unbanning releases both', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
    const categoryId = ((await post(superAdmin, '/categories', { name: 'ขนมไทย' })).body as { id: string }).id;
    const carrierId = ((await post(superAdmin, '/shipping-carriers', { name: 'ไปรษณีย์ไทย' })).body as { id: string }).id;
    const seller = newClient(app);
    const sellerId = await registerVerified(app, seller, SELLER);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await addressId(app, buyer);

    // The first shop sells one order through to SHIPPED — the buyer's turn (D5), which does not
    // block closing — and then closes.
    const firstShopId = ((await post(seller, '/shops', { communityId, name: 'ร้านแรก' })).body as { id: string }).id;
    await approveShop(app, firstShopId);
    const first = await listProduct(superAdmin, seller, categoryId);
    await post(buyer, '/cart/items', { variantId: first.variantId, quantity: 1 });
    const shippedOrderId = ((await checkoutAsShown(buyer, address)).body as { id: string }[])[0]!.id;
    await post(seller, `/shops/me/orders/${shippedOrderId}/shipping-fee`, { shippingAmountMinor: 2000 });
    const slip = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
    await buyer.post(`${API}/orders/${shippedOrderId}/payment-slips`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', slip, 'slip.jpg');
    await post(seller, `/shops/me/orders/${shippedOrderId}/confirm-payment`);
    expect((await post(seller, `/shops/me/orders/${shippedOrderId}/ship`, { shippingCarrierId: carrierId, trackingNumber: 'TH1234567890' })).status).toBe(200);
    expect((await post(seller, `/shops/${firstShopId}/close`)).status).toBe(200);

    // H12: applying again is how a shop moves — a second row for the same owner, selling now.
    const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
    await approveShop(app, shopId);
    const second = await listProduct(superAdmin, seller, categoryId);
    await post(buyer, '/cart/items', { variantId: second.variantId, quantity: 1 });
    const newOrderId = ((await checkoutAsShown(buyer, address)).body as { id: string }[])[0]!.id;

    expect((await ban(superAdmin, sellerId)).status).toBe(204);

    expect(await displayStatusOf(buyer, newOrderId)).toBe('FROZEN');
    expect(await displayStatusOf(buyer, shippedOrderId)).toBe('FROZEN');

    expect((await unban(superAdmin, sellerId)).status).toBe(204);

    expect(await displayStatusOf(buyer, newOrderId)).toBe('AWAITING_SHIPPING_QUOTE');
    expect(await displayStatusOf(buyer, shippedOrderId)).toBe('SHIPPED');
  });
});
