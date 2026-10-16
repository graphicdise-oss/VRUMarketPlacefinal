import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #59 (D5): the buyer's own "ได้รับของแล้ว" button — no auto-close anywhere, so an order left
 * SHIPPED stays SHIPPED until a human clicks this. N3: refused outright while frozen.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const ADMIN = 'admin@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
  completedAt: string | null;
}
interface CarrierBody {
  id: string;
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

async function createCarrier(superAdmin: Agent, name: string): Promise<CarrierBody> {
  const response = await superAdmin
    .post(`${API}/shipping-carriers`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name });

  return response.body as CarrierBody;
}

async function sellerWithShop(app: TestApp, email: string, communityId: string): Promise<{ seller: Agent; shopId: string }> {
  const seller = newClient(app);
  await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return { seller, shopId };
}

async function approvedProduct(
  superAdmin: Agent,
  seller: Agent,
  categoryId: string,
  name: string,
  variantName: string,
  priceAmountMinor: number,
  stock: number,
): Promise<ProductBody> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name,
      description: 'คำอธิบายสินค้าสำหรับทดสอบ',
      categoryId,
      variants: [{ name: variantName, priceAmountMinor, stock }],
    });
  const productId = (created.body as { id: string }).id;
  await approveProduct(superAdmin, productId);

  const fetched = await seller.get(`${API}/products/${productId}`);

  return fetched.body as ProductBody;
}

async function aRealSubdistrictPostalCodeId(app: TestApp): Promise<string> {
  const row = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  return row.id;
}

async function createAddress(app: TestApp, client: Agent): Promise<string> {
  const subdistrictPostalCodeId = await aRealSubdistrictPostalCodeId(app);
  const response = await client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId });

  return (response.body as { id: string }).id;
}

async function placeOrder(app: TestApp, buyer: Agent, variantId: string, quantity = 1): Promise<OrderBody> {
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity });
  const response = await checkoutAsShown(buyer, addressId);

  return (response.body as OrderBody[])[0]!;
}

async function setShippingFee(seller: Agent, orderId: string, shippingAmountMinor: number) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingAmountMinor });
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

async function uploadSlip(buyer: Agent, orderId: string): Promise<void> {
  await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
}

async function confirmPayment(seller: Agent, orderId: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/confirm-payment`)
    .set(CSRF_HEADER, await csrfToken(seller));
}

async function ship(seller: Agent, orderId: string, carrierId: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/ship`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingCarrierId: carrierId, trackingNumber: 'TH1234567890' });
}

async function receive(client: Agent, orderId: string) {
  return client.post(`${API}/orders/${orderId}/receive`).set(CSRF_HEADER, await csrfToken(client));
}

/** Order placed, quoted, paid, confirmed and shipped — status SHIPPED, ready to be received. */
async function orderShipped(
  app: TestApp,
): Promise<{ superAdmin: Agent; seller: Agent; shopId: string; buyer: Agent; order: OrderBody }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const carrier = await createCarrier(superAdmin, 'Kerry');
  const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบรับของ', 'สีแดง', 10000, 5);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
  await setShippingFee(seller, order.id, 2000);
  await uploadSlip(buyer, order.id);
  await confirmPayment(seller, order.id);
  const shipped = await ship(seller, order.id, carrier.id);

  return { superAdmin, seller, shopId, buyer, order: shipped.body as OrderBody };
}

describe('the buyer marks an order received — nobody else can (#59, D5)', () => {
  it('moves SHIPPED to COMPLETED and records completedAt', async () => {
    const app = getApp();
    const { buyer, order } = await orderShipped(app);

    const response = await receive(buyer, order.id);

    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.status).toBe('COMPLETED');
    expect(body.completedAt).not.toBeNull();
  });

  it('tells the shop the order was received — in-app, through the notification list (#69)', async () => {
    const app = getApp();
    const { seller, buyer, order } = await orderShipped(app);

    await receive(buyer, order.id);

    const notes = (await seller.get(`${API}/notifications`)).body as { items: { type: string; targetId: string | null }[] };
    expect(notes.items).toContainEqual(expect.objectContaining({ type: 'ORDER_RECEIVED', targetId: order.id }));
  });

  it('refuses before the order has shipped', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 'แบบเดียว', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);
    await confirmPayment(seller, order.id); // now PAID, not SHIPPED yet

    const response = await receive(buyer, order.id);

    expect(response.status).toBe(409);
  });

  it('refuses a second click — already COMPLETED', async () => {
    const app = getApp();
    const { buyer, order } = await orderShipped(app);
    const first = await receive(buyer, order.id);
    expect(first.status).toBe(200);

    const second = await receive(buyer, order.id);

    expect(second.status).toBe(409);
  });

  it('🚨 nobody but the buyer can call this — not the shop, not a community admin, not super admin', async () => {
    const app = getApp();
    const { superAdmin, seller, order } = await orderShipped(app);

    const bySeller = await receive(seller, order.id);
    expect(bySeller.status).toBe(404);

    const bySuperAdmin = await receive(superAdmin, order.id);
    expect(bySuperAdmin.status).toBe(404);

    const admin = newClient(app);
    await registerAndLogin(admin, ADMIN);
    const byAdmin = await receive(admin, order.id);
    expect(byAdmin.status).toBe(404);

    // The order itself never moved for any of the three attempts.
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('SHIPPED');
  });

  it('🚨 proves there is no auto-close — 60 days after shipping, the order is still SHIPPED', async () => {
    const app = getApp();
    const { buyer, order } = await orderShipped(app);

    app.clock.advanceByDays(60);
    await app.sweep.run();

    await login(buyer, BUYER); // 60 simulated days outlive the access token
    const body = (await buyer.get(`${API}/orders/${order.id}`)).body as OrderBody;
    expect(body.status).toBe('SHIPPED');
    expect(body.completedAt).toBeNull();
  });

  it('lets the buyer receive an order even after the shop has since closed (H12/J1)', async () => {
    const app = getApp();
    const { seller, shopId, buyer, order } = await orderShipped(app);
    await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller));
    const shopRow = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shopRow.closedAt).not.toBeNull();

    const response = await receive(buyer, order.id);

    expect(response.status).toBe(200);
  });

  it('refuses while the order is frozen, but succeeds once unfrozen again (N3 — temporary, not permanent)', async () => {
    const app = getApp();
    const { superAdmin, shopId, buyer, order } = await orderShipped(app);
    await superAdmin.post(`${API}/shops/${shopId}/suspend`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });

    const whileFrozen = await receive(buyer, order.id);
    expect(whileFrozen.status).toBe(409);
    expect(((await buyer.get(`${API}/orders/${order.id}`)).body as OrderBody).status).toBe('SHIPPED');

    await superAdmin.post(`${API}/shops/${shopId}/unsuspend`).set(CSRF_HEADER, await csrfToken(superAdmin));
    const afterUnfreeze = await receive(buyer, order.id);

    expect(afterUnfreeze.status).toBe(200);
  });

  it('refuses an order that does not exist, or belongs to another buyer', async () => {
    const app = getApp();
    const { order } = await orderShipped(app);
    const otherBuyer = newClient(app);
    await registerAndLogin(otherBuyer, 'other-buyer@example.test');

    const response = await receive(otherBuyer, order.id);

    expect(response.status).toBe(404);
  });
});
