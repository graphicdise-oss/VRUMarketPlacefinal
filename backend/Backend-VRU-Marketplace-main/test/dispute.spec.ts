import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * `Dispute` + `DisputeEvidence` (#63): opening (buyer, from the moment a slip exists, evidence
 * mandatory), D5b's window (paused while frozen, N3), K13's one-open-at-a-time, and the shop's
 * own response. Order.status is never touched by any of this (I6).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'otherbuyer@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
  displayStatus: string;
}
interface CarrierBody {
  id: string;
}
interface DisputeBody {
  id: string;
  orderId: string;
  reason: string;
  shopResponse: string | null;
  respondedAt: string | null;
  closedAt: string | null;
  evidence: { id: string; party: string }[];
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

async function approvedProduct(superAdmin: Agent, seller: Agent, categoryId: string, name: string, priceAmountMinor: number, stock: number): Promise<ProductBody> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ name, description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId, variants: [{ name: 'แบบเดียว', priceAmountMinor, stock }] });
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

async function openDispute(client: Agent, orderId: string, reason: string, fileCount = 1) {
  let req = client.post(`${API}/orders/${orderId}/dispute`).set(CSRF_HEADER, await csrfToken(client)).field('reason', reason);
  for (let i = 0; i < fileCount; i += 1) {
    req = req.attach('files', await aJpegBuffer(), `evidence-${String(i)}.jpg`);
  }
  return req;
}

async function respondDispute(seller: Agent, orderId: string, response: string, fileCount = 0) {
  let req = seller.post(`${API}/shops/me/orders/${orderId}/dispute/respond`).set(CSRF_HEADER, await csrfToken(seller)).field('response', response);
  for (let i = 0; i < fileCount; i += 1) {
    req = req.attach('files', await aJpegBuffer(), `response-${String(i)}.jpg`);
  }
  return req;
}

async function ban(client: Agent, userId: string, reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง') {
  return client
    .post(`${API}/admin/users/${userId}/ban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function unban(client: Agent, userId: string) {
  return client.post(`${API}/admin/users/${userId}/unban`).set(CSRF_HEADER, await csrfToken(client));
}

const DISPUTE_REASON = 'สินค้าที่ได้รับไม่ตรงกับที่สั่ง สีและขนาดผิดทั้งคู่ ตามรูปที่แนบ';

/** Order placed, quoted, and a slip uploaded — AWAITING PAYMENT_SUBMITTED, dispute-eligible. */
async function orderWithSlip(app: TestApp): Promise<{
  superAdmin: Agent;
  seller: Agent;
  sellerId: string;
  shopId: string;
  carrier: CarrierBody;
  buyer: Agent;
  order: OrderBody;
}> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const carrier = await createCarrier(superAdmin, 'Kerry');
  const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบข้อพิพาท', 10000, 5);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const placed = await placeOrder(app, buyer, product.variants[0]!.id, 1);
  await setShippingFee(seller, placed.id, 2000);
  await uploadSlip(buyer, placed.id);
  const fetched = await buyer.get(`${API}/orders/${placed.id}`);

  return { superAdmin, seller, sellerId, shopId, carrier, buyer, order: fetched.body as OrderBody };
}

async function orderShipped(app: TestApp) {
  const arranged = await orderWithSlip(app);
  await confirmPayment(arranged.seller, arranged.order.id);
  const shipped = await ship(arranged.seller, arranged.order.id, arranged.carrier.id);

  return { ...arranged, order: shipped.body as OrderBody };
}

async function orderCompleted(app: TestApp) {
  const shipped = await orderShipped(app);
  const received = await receive(shipped.buyer, shipped.order.id);

  return { ...shipped, order: received.body as OrderBody };
}

describe('#63 — opening a dispute', () => {
  it('refuses before any slip has been uploaded', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000); // AWAITING_PAYMENT — no slip yet

    const response = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(response.status).toBe(409);
  });

  it('refuses with no evidence attached', async () => {
    const app = getApp();
    const { buyer, order } = await orderWithSlip(app);

    const response = await openDispute(buyer, order.id, DISPUTE_REASON, 0);
    expect(response.status).toBe(400);
  });

  it('🚨 succeeds once a slip exists — Order.status is never touched, only displayStatus (I6)', async () => {
    const app = getApp();
    const { buyer, order } = await orderWithSlip(app);
    expect(order.status).toBe('PAYMENT_SUBMITTED');

    const response = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(response.status).toBe(201);
    const dispute = response.body as DisputeBody;
    expect(dispute.evidence).toHaveLength(1);
    expect(dispute.evidence[0]!.party).toBe('BUYER');
    expect(dispute.closedAt).toBeNull();

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('PAYMENT_SUBMITTED'); // completely unchanged

    const asBuyer = await buyer.get(`${API}/orders/${order.id}`);
    expect((asBuyer.body as OrderBody).displayStatus).toBe('DISPUTED');
  });

  it('K13: a second dispute cannot open while one is already open', async () => {
    const app = getApp();
    const { buyer, order } = await orderWithSlip(app);
    const first = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(first.status).toBe(201);

    const second = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(second.status).toBe(409);
  });

  it('K13: reopening after the first closes is allowed, and needs its own new evidence', async () => {
    const app = getApp();
    const { buyer, order } = await orderWithSlip(app);
    const first = await openDispute(buyer, order.id, DISPUTE_REASON);
    const firstDispute = first.body as DisputeBody;
    await closeByRuling(app, firstDispute.id);

    const reopened = await openDispute(buyer, order.id, 'ของใหม่ที่ร้านส่งมาเปลี่ยนให้ก็ยังพังอีก');
    expect(reopened.status).toBe(201);

    const list = await buyer.get(`${API}/orders/${order.id}/dispute`);
    expect((list.body as DisputeBody[])).toHaveLength(2);
  });

  it('nobody but the order’s own buyer may open a dispute on it', async () => {
    const app = getApp();
    const { seller, order } = await orderWithSlip(app);
    const other = newClient(app);
    await registerVerified(app, other, OTHER_BUYER);

    const bySeller = await openDispute(seller, order.id, DISPUTE_REASON);
    expect(bySeller.status).toBe(404);

    const byOther = await openDispute(other, order.id, DISPUTE_REASON);
    expect(byOther.status).toBe(404);
  });
});

/** Closes a dispute the real way — a super admin's SHOP_WINS ruling (#64) — rather than writing closedAt. */
async function closeByRuling(app: TestApp, disputeId: string): Promise<void> {
  await login(app.client, SUPER);
  const response = await app.client
    .post(`${API}/disputes/${disputeId}/ruling`)
    .set(CSRF_HEADER, await csrfToken(app.client))
    .send({ verdict: 'SHOP_WINS', reason: 'ตรวจสอบแล้วไม่พบว่าร้านทำผิด ปิดเรื่องนี้' });
  expect(response.status).toBe(200);
}

describe('#63 — D5b: the deadline to open a dispute', () => {
  it('open at 6 days after being received; refused at 8', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);

    app.clock.advanceByDays(6);
    await login(buyer, BUYER); // access tokens expire after 15 minutes — re-sign in after the advance
    const sixDays = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(sixDays.status).toBe(201);

    await closeByRuling(app, (sixDays.body as DisputeBody).id);
    app.clock.advanceByDays(2); // total 8 days since received
    await login(buyer, BUYER);
    const eightDays = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(eightDays.status).toBe(409);
  });

  it('"whichever comes first": shipped-but-never-received refuses at 16 days since shipping', async () => {
    const app = getApp();
    const { buyer, order } = await orderShipped(app); // never received

    app.clock.advanceByDays(16);
    await login(buyer, BUYER);
    const response = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(response.status).toBe(409);
  });

  it('a dispute deadline still open at 14 days since shipping (just under 15)', async () => {
    const app = getApp();
    const { buyer, order } = await orderShipped(app);

    app.clock.advanceByDays(14);
    await login(buyer, BUYER);
    const response = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(response.status).toBe(201);
  });

  it('N3: frozen time does not count against the 15-day window', async () => {
    const app = getApp();
    const { superAdmin, sellerId, buyer, order } = await orderShipped(app);

    app.clock.advanceByDays(14); // 1 day of the 15-day window left
    await login(superAdmin, SUPER);
    await ban(superAdmin, sellerId); // freezes the order
    app.clock.advanceByDays(10); // would have blown the deadline long ago if it kept ticking
    await login(superAdmin, SUPER);
    await unban(superAdmin, sellerId); // unfreezes — 10 days get added back to frozenDurationSeconds

    // Immediately after unfreezing, still within the (shifted) 15-day budget.
    await login(buyer, BUYER);
    const response = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(response.status).toBe(201);
  });

  it('currently-frozen orders may always open a dispute, deadline or not', async () => {
    const app = getApp();
    const { superAdmin, sellerId, buyer, order } = await orderShipped(app);

    app.clock.advanceByDays(30); // long past the 15-day window
    await login(superAdmin, SUPER);
    await ban(superAdmin, sellerId); // freezes the order — still frozen right now

    await login(buyer, BUYER);
    const response = await openDispute(buyer, order.id, DISPUTE_REASON);
    expect(response.status).toBe(201);
  });
});

describe('#63 — the shop responds', () => {
  it('responds once with text and evidence; a second attempt is refused', async () => {
    const app = getApp();
    const { seller, buyer, order } = await orderWithSlip(app);
    await openDispute(buyer, order.id, DISPUTE_REASON);

    const response = await respondDispute(seller, order.id, 'สินค้าที่จัดส่งตรงตามคำสั่งซื้อทุกประการ แนบรูปตอนแพ็คของก่อนส่ง', 2);
    expect(response.status).toBe(200);
    const dispute = response.body as DisputeBody;
    expect(dispute.shopResponse).not.toBeNull();
    expect(dispute.respondedAt).not.toBeNull();
    expect(dispute.evidence.filter((e) => e.party === 'SHOP')).toHaveLength(2);
    expect(dispute.evidence.filter((e) => e.party === 'BUYER')).toHaveLength(1);

    const second = await respondDispute(seller, order.id, 'ขอเพิ่มเติมอีกนิดหน่อยครับ');
    expect(second.status).toBe(409);
  });

  it('refuses when there is no open dispute to respond to', async () => {
    const app = getApp();
    const { seller, order } = await orderWithSlip(app);

    const response = await respondDispute(seller, order.id, 'สินค้าที่จัดส่งตรงตามคำสั่งซื้อทุกประการครบถ้วน');
    expect(response.status).toBe(404);
  });

  it('J2: a suspended shop may still respond normally', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, buyer, order } = await orderWithSlip(app);
    await openDispute(buyer, order.id, DISPUTE_REASON);
    await superAdmin
      .post(`${API}/shops/${shopId}/suspend`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });

    const response = await respondDispute(seller, order.id, 'สินค้าที่จัดส่งตรงตามคำสั่งซื้อทุกประการครบถ้วน');
    expect(response.status).toBe(200);
  });
});

describe('#63 — visibility and evidence files', () => {
  it('the buyer and the shop can each read their own dispute’s evidence; nobody else can', async () => {
    const app = getApp();
    const { seller, buyer, order } = await orderWithSlip(app);
    const opened = await openDispute(buyer, order.id, DISPUTE_REASON);
    const dispute = opened.body as DisputeBody;
    const evidenceId = dispute.evidence[0]!.id;

    const byBuyer = await buyer.get(`${API}/disputes/${dispute.id}/evidence/${evidenceId}`);
    expect(byBuyer.status).toBe(200);
    expect(byBuyer.headers['content-type']).toContain('image/jpeg');

    const byShop = await seller.get(`${API}/disputes/${dispute.id}/evidence/${evidenceId}`);
    expect(byShop.status).toBe(200);

    const other = newClient(app);
    await registerVerified(app, other, OTHER_BUYER);
    const byOther = await other.get(`${API}/disputes/${dispute.id}/evidence/${evidenceId}`);
    expect(byOther.status).toBe(404);
  });

  it('a shop cannot see disputes on someone else’s order', async () => {
    const app = getApp();
    const { order } = await orderWithSlip(app);
    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const shopRow = await app.prisma.shop.findUniqueOrThrow({ where: { id: orderRow.shopId } });

    const otherSeller = newClient(app);
    await registerVerified(app, otherSeller, 'otherseller@example.test');
    const otherShop = await otherSeller
      .post(`${API}/shops`)
      .set(CSRF_HEADER, await csrfToken(otherSeller))
      .send({ communityId: shopRow.communityId, name: 'ร้านอื่น' });
    await approveShop(app, (otherShop.body as { id: string }).id);

    const response = await otherSeller.get(`${API}/shops/me/orders/${order.id}/dispute`);
    expect(response.status).toBe(404);
  });
});
