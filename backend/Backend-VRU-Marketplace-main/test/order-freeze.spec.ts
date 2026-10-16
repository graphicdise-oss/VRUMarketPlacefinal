import sharp from 'sharp';
import { vi } from 'vitest';
import { OrderFreezeService } from '../src/order/services/order-freeze.service.js';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct, rejectProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #61 (I6/H2/H3/I10/H4): the one mechanism behind every freeze — seller ban, buyer ban, shop
 * suspension, a product ruled `PROHIBITED` — and unfreezing giving whichever clock was running a
 * fresh full window rather than resuming with what was left.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const BUYER_2 = 'buyer2@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
  displayStatus: string;
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

async function createCategory(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin
    .post(`${API}/categories`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name });

  return (response.body as { id: string }).id;
}

async function sellerWithShop(app: TestApp, email: string, communityId: string): Promise<{ seller: Agent; shopId: string; sellerId: string }> {
  const seller = newClient(app);
  const sellerId = await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return { seller, shopId, sellerId };
}

async function approvedProduct(
  superAdmin: Agent,
  seller: Agent,
  categoryId: string,
  name: string,
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
      variants: [{ name: 'แบบเดียว', priceAmountMinor, stock }],
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

async function placeOrder(app: TestApp, buyer: Agent, variantId: string, quantity = 1) {
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity });
  const response = await checkoutAsShown(buyer, addressId);

  return response;
}

async function placeOrderOk(app: TestApp, buyer: Agent, variantId: string, quantity = 1): Promise<OrderBody> {
  const response = await placeOrder(app, buyer, variantId, quantity);
  return (response.body as OrderBody[])[0]!;
}

async function setShippingFee(seller: Agent, orderId: string, shippingAmountMinor: number) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingAmountMinor });
}

async function ban(client: Agent, userId: string, reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง') {
  return client
    .post(`${API}/admin/users/${userId}/ban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function unban(client: Agent, userId: string) {
  return client.post(`${API}/admin/users/${userId}/unban`).set(CSRF_HEADER, await csrfToken(client)).send({});
}

async function suspend(client: Agent, shopId: string, reason = 'เหตุผลสำหรับทดสอบการระงับร้าน') {
  return client
    .post(`${API}/shops/${shopId}/suspend`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function rejectProhibited(superAdmin: Agent, productId: string) {
  return rejectProduct(superAdmin, productId, { category: 'PROHIBITED', reason: 'สินค้านี้ผิดกฎหมายตามที่แจ้งไว้ในระเบียบชุมชน' });
}

async function getOrder(client: Agent, orderId: string) {
  const response = await client.get(`${API}/orders/${orderId}`);
  return response.body as OrderBody;
}

describe('#61 — freezing an order: one mechanism, stacked reasons, status never overwritten', () => {
  it('banning a seller freezes every non-terminal order their shop is selling — status stays untouched (I6)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const superAdminId = await app.prisma.user
      .findUniqueOrThrow({ where: { email: SUPER }, select: { id: true } })
      .then((u) => u.id);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, sellerId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000); // AWAITING_PAYMENT

    const banResponse = await ban(superAdmin, sellerId);
    expect(banResponse.status).toBe(204);

    const asBuyer = await getOrder(buyer, order.id);
    expect(asBuyer.status).toBe('AWAITING_PAYMENT');
    expect(asBuyer.displayStatus).toBe('FROZEN');

    const frozenRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(frozenRow.status).toBe('AWAITING_PAYMENT');
    expect(frozenRow.frozenAt).not.toBeNull();

    const reasons = await app.prisma.orderFreezeReason.findMany({ where: { orderId: order.id } });
    expect(reasons.map((r) => r.reason)).toEqual(['SELLER_BANNED']);

    const auditEntry = await app.prisma.auditLog.findFirst({ where: { action: 'ORDER_FROZEN', targetId: order.id } });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorUserId).toBe(superAdminId);
    expect(auditEntry?.reason).toBe('SELLER_BANNED');
  });

  it('banning a buyer freezes their own non-terminal orders across shops', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id);

    await ban(superAdmin, buyerId);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('AWAITING_SHIPPING_QUOTE');
    expect(row.frozenAt).not.toBeNull();
  });

  it('H2: stock stays reserved for the whole freeze — a second buyer cannot take the last unit even 30 days in', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, sellerId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของชิ้นสุดท้าย', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id, 1);

    await ban(superAdmin, sellerId);
    app.clock.advanceByDays(30);
    await app.sweep.run();

    const stillFrozen = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillFrozen.status).toBe('AWAITING_SHIPPING_QUOTE');
    expect(stillFrozen.frozenAt).not.toBeNull();

    const buyer2 = newClient(app);
    await registerVerified(app, buyer2, BUYER_2);
    const secondAttempt = await placeOrder(app, buyer2, product.variants[0]!.id, 1);
    expect(secondAttempt.status).toBe(409);
  });

  it('stacked reasons: unbanning the buyer alone leaves the order frozen while the shop is still suspended', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id);

    const adminA = newClient(app);
    const adminAId = await registerVerified(app, adminA, ADMIN_A);
    await assignAdmin(superAdmin, communityId, adminAId);

    await suspend(adminA, shopId);
    await ban(superAdmin, buyerId);

    const reasonsAfterBoth = await app.prisma.orderFreezeReason.findMany({ where: { orderId: order.id } });
    expect(reasonsAfterBoth.map((r) => r.reason).sort()).toEqual(['BUYER_BANNED', 'SHOP_SUSPENDED']);

    await unban(superAdmin, buyerId);

    const stillFrozen = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillFrozen.frozenAt).not.toBeNull();
    const remaining = await app.prisma.orderFreezeReason.findMany({ where: { orderId: order.id } });
    expect(remaining.map((r) => r.reason)).toEqual(['SHOP_SUSPENDED']);
  });

  it('H3: unfreezing gives the running clock a fresh full window, not the remainder it had left', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000); // AWAITING_PAYMENT, clock 2 starts now

    // Clock 2 has 24h total; use up 23 of them before freezing, so only 1h would remain if the
    // window merely resumed instead of resetting.
    app.clock.advanceByHours(23);
    await login(superAdmin, SUPER); // access tokens expire after 15 minutes — re-sign in after the advance
    await ban(superAdmin, buyerId); // buyer ban freezes it (also freezes as the order's own buyer)

    // Frozen for 3 days — H3/H2 says the clock does not expire while frozen, however long.
    app.clock.advanceByDays(3);
    await app.sweep.run();
    const stillFrozen = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillFrozen.status).toBe('AWAITING_PAYMENT');

    await login(superAdmin, SUPER);
    await unban(superAdmin, buyerId);
    const unfrozen = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unfrozen.frozenAt).toBeNull();

    // If the window had only resumed with ~1h left, 20 more hours would already have expired it.
    app.clock.advanceByHours(20);
    await app.sweep.run();
    const stillAlive = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillAlive.status).toBe('AWAITING_PAYMENT');

    // But a fresh 24h window is not unlimited either — past it, the sweep still cancels normally.
    app.clock.advanceByHours(5);
    await app.sweep.run();
    const expired = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(expired.status).toBe('CANCELLED');
  });

  it('the same H3 reset applies to clock 1 (AWAITING_SHIPPING_QUOTE), which #61 gave its own window-start column', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, sellerId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id); // AWAITING_SHIPPING_QUOTE

    app.clock.advanceByHours(23);
    await login(superAdmin, SUPER); // access tokens expire after 15 minutes — re-sign in after the advance
    await ban(superAdmin, sellerId);
    app.clock.advanceByDays(3);
    await app.sweep.run();

    await login(superAdmin, SUPER);
    const unbanResponse = await unban(superAdmin, sellerId);
    expect(unbanResponse.status).toBe(204);

    app.clock.advanceByHours(20);
    await app.sweep.run();
    const stillAlive = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillAlive.status).toBe('AWAITING_SHIPPING_QUOTE');

    app.clock.advanceByHours(5);
    await app.sweep.run();
    const expired = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(expired.status).toBe('CANCELLED');
  });
});

describe('#61 — H4: a product ruled PROHIBITED cancels unpaid orders and freezes paid ones', () => {
  async function editBackToPendingAs(seller: Agent, productId: string, categoryId: string): Promise<void> {
    // Only a PENDING product can be rejected (#43) — a product with orders against it got there by
    // being approved and then edited, which sends it back to PENDING (invariant 6).
    const response = await seller
      .patch(`${API}/products/${productId}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'ของต้องห้าม (แก้ไข)', description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId });
    expect(response.status).toBe(200);
  }

  it('cancels an order still awaiting shipping quote, and releases its stock reservation', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของต้องห้าม', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id, 1);
    expect(order.status).toBe('AWAITING_SHIPPING_QUOTE');
    await editBackToPendingAs(seller, product.id, categoryId);

    const rejectResponse = await rejectProhibited(superAdmin, product.id);
    expect(rejectResponse.status).toBe(200);

    const row = await getOrder(buyer, order.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.displayStatus).toBe('CANCELLED');

    // The one unit is free again: once the product is fixed and approved, a second buyer can
    // take it. Had the cancelled order's reservation still counted, this checkout would be 409.
    await editBackToPendingAs(seller, product.id, categoryId);
    await approveProduct(superAdmin, product.id);
    const second = newClient(app);
    await registerVerified(app, second, BUYER_2);
    const secondOrder = await placeOrder(app, second, product.variants[0]!.id, 1);
    expect(secondOrder.status).toBe(201);
  });

  it('freezes (not cancels) an order that already reached PAID', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของต้องห้าม', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);
    await buyer
      .post(`${API}/orders/${order.id}/payment-slips`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer(), 'slip.jpg');
    expect((await seller.post(`${API}/shops/me/orders/${order.id}/confirm-payment`).set(CSRF_HEADER, await csrfToken(seller))).status).toBe(200);
    await editBackToPendingAs(seller, product.id, categoryId);

    const rejectResponse = await rejectProhibited(superAdmin, product.id);
    expect(rejectResponse.status).toBe(200);

    const row = await getOrder(buyer, order.id);
    expect(row.status).toBe('PAID');
    expect(row.displayStatus).toBe('FROZEN');

    const reasons = await app.prisma.orderFreezeReason.findMany({ where: { orderId: order.id } });
    expect(reasons.map((r) => r.reason)).toEqual(['PRODUCT_PROHIBITED']);
  });
});

describe('#61 — permissions: freezing only ever happens through guards that already exist (#32)', () => {
  it('a community admin cannot suspend (and so cannot freeze) a shop outside their own community', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const adminA = newClient(app);
    const adminAId = await registerVerified(app, adminA, ADMIN_A);
    await assignAdmin(superAdmin, communityA, adminAId);

    const { seller, shopId } = await sellerWithShop(app, SELLER, communityB);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id);

    const response = await suspend(adminA, shopId);
    expect(response.status).toBe(403);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.frozenAt).toBeNull();
  });

  it('only a super admin may ban — an ordinary community admin cannot, so cannot freeze this way either', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const adminA = newClient(app);
    const adminAId = await registerVerified(app, adminA, ADMIN_A);
    await assignAdmin(superAdmin, communityId, adminAId);

    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);

    const response = await ban(adminA, buyerId);
    expect(response.status).toBe(403);
  });
});

describe('code review of topic 10 — freezing (§85)', () => {
  async function editBackToPending(seller: Agent, productId: string, categoryId: string) {
    return seller
      .patch(`${API}/products/${productId}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'ชื่อที่แก้แล้ว', description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId });
  }

  async function paymentSubmittedOrder(app: TestApp) {
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);

    return { superAdmin, seller, shopId, sellerId, buyer, buyerId, order, product, categoryId };
  }

  it('a product ruled PROHIBITED freezes an order whose slip is already up — the buyer has paid, so it is not cancelled (H4/H5)', async () => {
    const app = getApp();
    const { superAdmin, seller, buyer, order, product, categoryId } = await paymentSubmittedOrder(app);
    await buyer
      .post(`${API}/orders/${order.id}/payment-slips`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer(), 'slip.jpg');
    await editBackToPending(seller, product.id, categoryId);

    expect((await rejectProhibited(superAdmin, product.id)).status).toBe(200);

    const body = await getOrder(buyer, order.id);
    expect(body.status).toBe('PAYMENT_SUBMITTED');
    expect(body.displayStatus).toBe('FROZEN');
  });

  it('a product ruled PROHIBITED cancelling an already-frozen unpaid order also lifts the freeze — the shop can close again', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, buyer, buyerId, order, product, categoryId } = await paymentSubmittedOrder(app);
    await ban(superAdmin, buyerId);
    await editBackToPending(seller, product.id, categoryId);

    expect((await rejectProhibited(superAdmin, product.id)).status).toBe(200);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.frozenAt).toBeNull();
    const closed = await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller));
    expect(closed.status).toBe(200);
    void buyer;
  });

  it('lifting a seller ban while the shop is being suspended never leaves the order unfrozen with a live reason on it', async () => {
    const app = getApp();
    const { superAdmin, shopId, sellerId, order } = await paymentSubmittedOrder(app);
    await ban(superAdmin, sellerId);
    // The private step that clears frozenAt, reached through Nest's own typed lookup.
    const freeze = app.app.get<OrderFreezeService, { clearFreezeAndResetClock: (...args: unknown[]) => Promise<void> }>(OrderFreezeService);
    const original = freeze.clearFreezeAndResetClock.bind(freeze);
    let suspension: ReturnType<typeof suspend> | undefined;
    vi.spyOn(freeze, 'clearFreezeAndResetClock').mockImplementationOnce(async (...args: unknown[]) => {
      // A second, independent request, fired while this transaction is about to clear frozenAt:
      // under the old code it read frozenAt as still set and so never set it again. Not awaited
      // here — with the §85 row lock it has to wait for this transaction to commit.
      suspension = suspend(superAdmin, shopId);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return original(...args);
    });

    expect((await unban(superAdmin, sellerId)).status).toBe(204);

    expect((await suspension)?.status).toBe(200);
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { freezeReasons: true } });
    expect(row.freezeReasons.map((reason) => reason.reason)).toEqual(['SHOP_SUSPENDED']);
    expect(row.frozenAt).not.toBeNull();
  });
});
