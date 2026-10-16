import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct, approveShopAs } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #37: closing a shop — soft delete, reopening proves the partial unique index from #34 is
 * really partial, and I12's disputeLostCount must survive the close-and-reopen or the one
 * enforcement mechanism a losing dispute has (spec 4/12) stops meaning anything.
 *
 * #39 (I11 · J1): the condition `blockingOrders()` left vacuously empty — closing must refuse
 * while any order still needs *the shop's own* action, and must succeed the moment the only
 * orders left are `SHIPPED` (the buyer's turn, per D5's no-auto-close) or already terminal.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER = 'other@example.test';
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

async function applyForShop(client: Agent, communityId: string): Promise<string> {
  const response = await client
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ communityId, name: 'ร้านทดสอบ' });

  return (response.body as MyShopBody).id;
}

async function close(client: Agent, shopId: string) {
  return client.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(client));
}

interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
}
interface CarrierBody {
  id: string;
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

async function approvedProduct(superAdmin: Agent, seller: Agent, categoryId: string, name: string): Promise<ProductBody> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ name, description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId, variants: [{ name: 'แบบเดียว', priceAmountMinor: 10000, stock: 5 }] });
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

async function placeOrder(app: TestApp, buyer: Agent, variantId: string): Promise<OrderBody> {
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity: 1 });
  const response = await checkoutAsShown(buyer, addressId);

  return (response.body as OrderBody[])[0]!;
}

async function setShippingFee(seller: Agent, orderId: string, shippingAmountMinor = 2000) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingAmountMinor });
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

async function uploadPaymentSlip(buyer: Agent, orderId: string) {
  return buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
}

async function confirmPayment(seller: Agent, orderId: string) {
  return seller.post(`${API}/shops/me/orders/${orderId}/confirm-payment`).set(CSRF_HEADER, await csrfToken(seller));
}

async function ship(seller: Agent, orderId: string, carrierId: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/ship`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingCarrierId: carrierId, trackingNumber: 'TH1234567890' });
}

async function markReceived(buyer: Agent, orderId: string) {
  return buyer.post(`${API}/orders/${orderId}/receive`).set(CSRF_HEADER, await csrfToken(buyer));
}

async function cancelAsBuyer(buyer: Agent, orderId: string) {
  return buyer.post(`${API}/orders/${orderId}/cancel`).set(CSRF_HEADER, await csrfToken(buyer)).send({});
}

async function openDispute(client: Agent, orderId: string, reason: string) {
  return client
    .post(`${API}/orders/${orderId}/dispute`)
    .set(CSRF_HEADER, await csrfToken(client))
    .field('reason', reason)
    .attach('files', await aJpegBuffer(), 'evidence.jpg');
}

async function submitRefundAccount(buyer: Agent, orderId: string) {
  return buyer
    .post(`${API}/orders/${orderId}/refund-account`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ type: 'PROMPTPAY', promptPayId: '0899999999' });
}

async function uploadRefundSlip(seller: Agent, orderId: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/refund-slips`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .attach('file', await aJpegBuffer(), 'refund-slip.jpg');
}

async function confirmRefundReceived(buyer: Agent, orderId: string) {
  return buyer.post(`${API}/orders/${orderId}/refund-received`).set(CSRF_HEADER, await csrfToken(buyer));
}

async function ban(client: Agent, userId: string, reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง') {
  return client
    .post(`${API}/admin/users/${userId}/ban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function userIdOf(app: TestApp, email: string): Promise<string> {
  const user = await app.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return user.id;
}

/** A community, an approved shop, an approved product and a real shipping carrier — the fixture every #39 test starts from. */
async function scenario(app: TestApp): Promise<{
  superAdmin: Agent;
  seller: Agent;
  shopId: string;
  buyer: Agent;
  variantId: string;
  carrierId: string;
}> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const carrier = await createCarrier(superAdmin, 'Kerry');

  const seller = newClient(app);
  await registerVerified(app, seller, SELLER);
  const shopId = await applyForShop(seller, communityId);
  await approveShopAs(superAdmin, shopId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบปิดร้าน');

  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);

  return { superAdmin, seller, shopId, buyer, variantId: product.variants[0]!.id, carrierId: carrier.id };
}

describe('closing a shop (soft delete)', () => {
  it('lets the owner close their own approved shop', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyForShop(seller, communityId);
    await approveShopAs(superAdmin, shopId);

    const response = await close(seller, shopId);

    expect(response.status).toBe(200);
    expect((response.body as MyShopBody).closedAt).not.toBeNull();

    const row = await app.prisma.shop.findUnique({ where: { id: shopId } });
    expect(row).not.toBeNull(); // soft delete — the row still exists
    expect(row?.closedAt).not.toBeNull();

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'SHOP_CLOSED', targetId: shopId },
    });
    expect(entry).not.toBeNull();
    // Code review (2026-09-22, §77): backfills the community_id §75 added to audit_log.
    expect(entry?.communityId).toBe(communityId);
  });

  it('refuses somebody who is not the shop’s owner', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyForShop(seller, communityId);

    const other = newClient(app);
    await registerAndLogin(other, OTHER);

    const response = await close(other, shopId);

    expect(response.status).toBe(403);
  });

  it('answers 409 closing a shop that is already closed', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyForShop(seller, communityId);
    await close(seller, shopId);

    const response = await close(seller, shopId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });
});

describe('after closing: reopen proves the partial unique index is really partial (#34)', () => {
  it('lets the owner apply again in a different community after closing — this is how a shop moves (H12)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const firstShopId = await applyForShop(seller, communityA);
    await approveShopAs(superAdmin, firstShopId);
    await close(seller, firstShopId);

    // Before #37 this was already blocked by the plain unique index #34's schema comment warns
    // about — a second row for this owner would have been rejected regardless of community.
    const secondShopId = await applyForShop(seller, communityB);

    expect(secondShopId).not.toBe(firstShopId);
    const secondShop = await app.prisma.shop.findUnique({ where: { id: secondShopId } });
    expect(secondShop?.communityId).toBe(communityB);
    expect(secondShop?.closedAt).toBeNull();
  });

  it('carries disputeLostCount to the new shop — the statistic lives on the person, not the shop (I12)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    const sellerId = await registerVerified(app, seller, SELLER);
    const firstShopId = await applyForShop(seller, communityId);
    await approveShopAs(superAdmin, firstShopId);

    // Arranged directly (#76 keeps it): three lost disputes through the real flow is three full
    // order-and-dispute cycles, and this test only proves the count survives closing and reopening.
    await app.prisma.user.update({ where: { id: sellerId }, data: { disputeLostCount: 3 } });

    await close(seller, firstShopId);
    const secondShopId = await applyForShop(seller, communityId);
    await approveShopAs(superAdmin, secondShopId);

    const listing = await newClient(app).get(`${API}/shops`).query({ communityId });
    const body = listing.body as { items: { id: string; disputeLostCount: number }[] };
    const newShop = body.items.find((item) => item.id === secondShopId);
    expect(newShop?.disputeLostCount).toBe(3);
  });
});

describe('a closed shop: hidden from the list, still reachable by direct link, orders/reviews survive', () => {
  it('disappears from the public list but the direct link still answers 200 with closedAt set', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = await applyForShop(seller, communityId);
    await approveShopAs(superAdmin, shopId);
    await close(seller, shopId);

    const list = await newClient(app).get(`${API}/shops`).query({ communityId });
    expect((list.body as { items: { id: string }[] }).items.map((item) => item.id)).not.toContain(
      shopId,
    );

    const direct = await newClient(app).get(`${API}/shops/${shopId}`);
    expect(direct.status).toBe(200);
    const body = direct.body as { id: string; closedAt: string | null };
    expect(body.id).toBe(shopId);
    expect(body.closedAt).not.toBeNull();
  });
});

describe('#39 — blocked while an order still needs the shop’s own action (I11 · J1)', () => {
  it('AWAITING_SHIPPING_QUOTE blocks — the shop hasn’t quoted shipping yet', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);

    const response = await close(seller, shopId);

    expect(response.status).toBe(409);
    const body = response.body as ErrorBody;
    expect(body.code).toBe('CONFLICT');
    expect(body.fieldErrors).toEqual({ [order.id]: 'รอร้านใส่ค่าส่ง' });

    const row = await app.prisma.shop.findUnique({ where: { id: shopId } });
    expect(row?.closedAt).toBeNull();
  });

  it('AWAITING_PAYMENT blocks — quoted, but the buyer hasn’t transferred yet (the shop still owes a confirmation once they do)', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, order.id);

    const response = await close(seller, shopId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).fieldErrors).toEqual({ [order.id]: 'รอผู้ซื้อโอนเงิน' });
  });

  it('PAYMENT_SUBMITTED blocks — a slip is up, the shop still has to confirm it', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, order.id);
    await uploadPaymentSlip(buyer, order.id);

    const response = await close(seller, shopId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).fieldErrors).toEqual({ [order.id]: 'รอร้านยืนยันเงินเข้า' });
  });

  it('PAID blocks — confirmed, the shop still has to ship it', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, order.id);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);

    const response = await close(seller, shopId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).fieldErrors).toEqual({ [order.id]: 'จ่ายแล้ว รอร้านส่งของ' });
  });

  it('REFUND_ORDERED blocks — the shop still owes a refund', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, order.id);
    await uploadPaymentSlip(buyer, order.id);

    // Clock 3's own 3-day timeout (I1) — the real way to REFUND_ORDERED, not a shortcut write.
    app.clock.advanceByDays(3);
    await app.sweep.run();
    await login(seller, SELLER);
    await login(buyer, BUYER);

    const response = await close(seller, shopId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).fieldErrors).toEqual({ [order.id]: 'ถูกสั่งให้คืนเงิน' });
  });

  it('a frozen order blocks — an admin still owes it a decision, even though it happens to be SHIPPED (which alone would not block)', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, buyer, variantId, carrierId } = await scenario(app);
    const buyerId = await userIdOf(app, BUYER);
    const order = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, order.id);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(seller, order.id, carrierId);

    await ban(superAdmin, buyerId); // I10: freezes every non-terminal order this buyer has, including SHIPPED ones

    const response = await close(seller, shopId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).fieldErrors).toEqual({ [order.id]: 'ถูกแช่แข็ง รอแอดมินตัดสิน' });
  });

  it('reports every blocking order at once, each keyed by its own id, and the message states the count', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId } = await scenario(app);
    const stillQuoting = await placeOrder(app, buyer, variantId);
    const stillPaying = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, stillPaying.id);

    const response = await close(seller, shopId);

    expect(response.status).toBe(409);
    const body = response.body as ErrorBody;
    expect(body.message).toContain('2');
    expect(body.fieldErrors).toEqual({
      [stillQuoting.id]: 'รอร้านใส่ค่าส่ง',
      [stillPaying.id]: 'รอผู้ซื้อโอนเงิน',
    });
  });
});

describe('#39 — not blocked: SHIPPED (the buyer’s turn) and every terminal status', () => {
  it('closes fine while an order is SHIPPED — this is the row the AC calls out as the one most likely to be coded wrong', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId, carrierId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, order.id);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(seller, order.id, carrierId);

    const response = await close(seller, shopId);

    expect(response.status).toBe(200);
    const row = await app.prisma.shop.findUnique({ where: { id: shopId } });
    expect(row?.closedAt).not.toBeNull();
  });

  it('SHIPPED orders on an already-closed shop: the buyer can still mark one received and open a dispute on another — closing never shifts the burden onto them', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId, carrierId } = await scenario(app);
    // Both orders must exist before the shop closes — a closed shop takes no new business
    // (invariant 6's visibility layer), so this proves the two actions still work *afterward*
    // on orders that were already outstanding, not that new ones can still be placed.
    const toReceive = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, toReceive.id);
    await uploadPaymentSlip(buyer, toReceive.id);
    await confirmPayment(seller, toReceive.id);
    await ship(seller, toReceive.id, carrierId);

    const toDispute = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, toDispute.id);
    await uploadPaymentSlip(buyer, toDispute.id);
    await confirmPayment(seller, toDispute.id);
    await ship(seller, toDispute.id, carrierId);

    await close(seller, shopId);

    const received = await markReceived(buyer, toReceive.id);
    expect(received.status).toBe(200);

    const dispute = await openDispute(buyer, toDispute.id, 'สินค้าที่ได้รับไม่ตรงกับที่สั่ง');
    expect(dispute.status).toBe(201);
  });

  it('closes fine while an order is COMPLETED', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId, carrierId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, order.id);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(seller, order.id, carrierId);
    await markReceived(buyer, order.id);

    const response = await close(seller, shopId);

    expect(response.status).toBe(200);
  });

  it('closes fine while an order is CANCELLED', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);
    await cancelAsBuyer(buyer, order.id);

    const response = await close(seller, shopId);

    expect(response.status).toBe(200);
  });

  it('closes fine while an order is REFUNDED — the loop resolved, nothing left for the shop to do', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variantId } = await scenario(app);
    const order = await placeOrder(app, buyer, variantId);
    await setShippingFee(seller, order.id);
    await uploadPaymentSlip(buyer, order.id);

    app.clock.advanceByDays(3);
    await app.sweep.run();
    await login(seller, SELLER);
    await login(buyer, BUYER);

    await submitRefundAccount(buyer, order.id);
    await uploadRefundSlip(seller, order.id);
    await confirmRefundReceived(buyer, order.id);

    const response = await close(seller, shopId);

    expect(response.status).toBe(200);
  });
});
