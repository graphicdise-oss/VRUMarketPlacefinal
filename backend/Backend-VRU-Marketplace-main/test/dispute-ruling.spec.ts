import sharp from 'sharp';
import { vi } from 'vitest';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { OrderStockAdjustmentPort } from '../src/order/ports/order-stock-adjustment.port.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #64: ruling on a dispute (K12 — reason mandatory, both sides see it), a super admin's override
 * (I9b — never a community admin's own reversal), no appeal route at all (I9), and the one
 * break-glass door into an order's PII while its dispute is open (I5).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
}
interface DisputeBody {
  id: string;
  orderId: string;
  closedAt: string | null;
  verdict: string | null;
  rulingReason: string | null;
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

async function openDispute(client: Agent, orderId: string, reason: string): Promise<DisputeBody> {
  const response = await client
    .post(`${API}/orders/${orderId}/dispute`)
    .set(CSRF_HEADER, await csrfToken(client))
    .field('reason', reason)
    .attach('files', await aJpegBuffer(), 'evidence.jpg');

  return response.body as DisputeBody;
}

async function ruleDispute(client: Agent, disputeId: string, verdict: string, reason: string) {
  return client
    .post(`${API}/disputes/${disputeId}/ruling`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ verdict, reason });
}

async function overrideDispute(client: Agent, disputeId: string, verdict: string, reason: string) {
  return client
    .post(`${API}/disputes/${disputeId}/override`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ verdict, reason });
}

async function breakGlass(client: Agent, disputeId: string, reason: string) {
  return client
    .post(`${API}/disputes/${disputeId}/break-glass`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function ban(client: Agent, userId: string, reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง') {
  return client
    .post(`${API}/admin/users/${userId}/ban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

const RULING_REASON = 'จากหลักฐานทั้งสองฝ่าย สินค้าที่ส่งไม่ตรงตามที่ตกลงไว้จริง ผู้ซื้อจึงเป็นฝ่ายถูก';

/** A community, its admin, a shop with an open dispute — status still PAYMENT_SUBMITTED. */
async function openDisputeScenario(app: TestApp): Promise<{
  superAdmin: Agent;
  adminA: Agent;
  seller: Agent;
  sellerId: string;
  shopId: string;
  buyer: Agent;
  order: OrderBody;
  dispute: DisputeBody;
}> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

  const adminA = newClient(app);
  const adminAId = await registerVerified(app, adminA, ADMIN_A);
  await assignAdmin(superAdmin, communityId, adminAId);

  const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบข้อพิพาท', 10000, 5);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
  await setShippingFee(seller, order.id, 2000);
  await uploadSlip(buyer, order.id);

  const dispute = await openDispute(buyer, order.id, 'สินค้าที่ได้รับไม่ตรงกับที่สั่งเลยครับ');

  return { superAdmin, adminA, seller, sellerId, shopId, buyer, order, dispute };
}

describe('#64 — ruling on a dispute (K12)', () => {
  it('BUYER_WINS moves the order to REFUND_ORDERED and costs the shop owner a disputeLostCount — but leaves the dispute open (#65 closes it)', async () => {
    const app = getApp();
    const { adminA, sellerId, order, dispute } = await openDisputeScenario(app);

    const response = await ruleDispute(adminA, dispute.id, 'BUYER_WINS', RULING_REASON);
    expect(response.status).toBe(200);
    const body = response.body as DisputeBody;
    // 🚨 Deliberately still open — H7's own AC calls this dispute's closing its job, not the
    // ruling's (see Dispute.closedAt's own schema comment). Only SHOP_WINS closes immediately.
    expect(body.closedAt).toBeNull();
    expect(body.verdict).toBe('BUYER_WINS');
    expect(body.rulingReason).toBe(RULING_REASON);

    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderRow.status).toBe('REFUND_ORDERED');

    const sellerRow = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(sellerRow.disputeLostCount).toBe(1);

    const auditEntry = await app.prisma.auditLog.findFirst({ where: { action: 'DISPUTE_RULED', targetId: dispute.id } });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.reason).toContain('BUYER_WINS');
  });

  it('SHOP_WINS leaves Order.status completely untouched — no disputeLostCount change either', async () => {
    const app = getApp();
    const { adminA, sellerId, order, dispute } = await openDisputeScenario(app);

    const response = await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);
    expect(response.status).toBe(200);

    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderRow.status).toBe('PAYMENT_SUBMITTED'); // unchanged

    const sellerRow = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(sellerRow.disputeLostCount).toBe(0);
  });

  it('J3: ruling releases a freeze on the order — the freeze-reason list clears too', async () => {
    const app = getApp();
    const { superAdmin, adminA, sellerId, order, dispute } = await openDisputeScenario(app);
    await ban(superAdmin, sellerId); // freezes the order (unrelated to the dispute)

    const frozenRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(frozenRow.frozenAt).not.toBeNull();

    const response = await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);
    expect(response.status).toBe(200);

    const unfrozenRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unfrozenRow.frozenAt).toBeNull();
  });

  it('I7: a BUYER_WINS ruling on an already-paid order fires the stock-adjustment notice', async () => {
    const app = getApp();
    const scenario = await openDisputeScenario(app);
    const { adminA, order, dispute } = scenario;
    const { seller } = scenario;
    expect((await seller.post(`${API}/shops/me/orders/${order.id}/confirm-payment`).set(CSRF_HEADER, await csrfToken(seller))).status).toBe(200);
    const notify = vi.spyOn(app.app.get(OrderStockAdjustmentPort), 'notify');

    const response = await ruleDispute(adminA, dispute.id, 'BUYER_WINS', RULING_REASON);
    expect(response.status).toBe(200);
    expect(notify).toHaveBeenCalledExactlyOnceWith(order.id);
  });

  it('refuses without a reason, and refuses ruling twice (use override instead)', async () => {
    const app = getApp();
    const { adminA, dispute } = await openDisputeScenario(app);

    const noReason = await adminA.post(`/api/v1/disputes/${dispute.id}/ruling`).set(CSRF_HEADER, await csrfToken(adminA)).send({ verdict: 'SHOP_WINS' });
    expect(noReason.status).toBe(400);

    const first = await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);
    expect(first.status).toBe(200);

    const second = await ruleDispute(adminA, dispute.id, 'BUYER_WINS', RULING_REASON);
    expect(second.status).toBe(409);
  });

  it('a community admin outside the shop’s community cannot rule; super admin can', async () => {
    const app = getApp();
    const { superAdmin, dispute } = await openDisputeScenario(app);
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const adminB = newClient(app);
    const adminBId = await registerVerified(app, adminB, 'admin-b@example.test');
    await assignAdmin(superAdmin, communityB, adminBId);

    const byAdminB = await ruleDispute(adminB, dispute.id, 'SHOP_WINS', RULING_REASON);
    expect(byAdminB.status).toBe(403);

    const bySuper = await ruleDispute(superAdmin, dispute.id, 'SHOP_WINS', RULING_REASON);
    expect(bySuper.status).toBe(200);
  });

  it('🚨 no appeal route exists — a guessed path answers 404, not 403', async () => {
    const app = getApp();
    const { buyer, dispute } = await openDisputeScenario(app);

    const response = await buyer.post(`/api/v1/disputes/${dispute.id}/appeal`).set(CSRF_HEADER, await csrfToken(buyer)).send({});
    expect(response.status).toBe(404);
  });
});

describe('#64 — I9b: super admin override, never a community admin’s own reversal', () => {
  it('a community admin cannot override even their own ruling', async () => {
    const app = getApp();
    const { adminA, dispute } = await openDisputeScenario(app);
    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    const response = await overrideDispute(adminA, dispute.id, 'BUYER_WINS', 'ทบทวนแล้วเห็นว่าผู้ซื้อถูก');
    expect(response.status).toBe(403);
  });

  it('super admin overrides SHOP_WINS -> BUYER_WINS: disputeLostCount +1, the refund is ordered (§85), and the dispute reopens for the refund loop (§102)', async () => {
    const app = getApp();
    const { superAdmin, adminA, sellerId, order, dispute } = await openDisputeScenario(app);
    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    const response = await overrideDispute(superAdmin, dispute.id, 'BUYER_WINS', 'ตรวจสอบเพิ่มเติมแล้วพบว่าผู้ซื้อถูกจริง');
    expect(response.status).toBe(200);
    const body = response.body as DisputeBody;
    expect(body.verdict).toBe('BUYER_WINS');
    // §102 (owner's decision): open again, like a first BUYER_WINS ruling — the refund loop it just
    // started is what closes it, and admins follow that loop through it.
    expect(body.closedAt).toBeNull();

    const sellerRow = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(sellerRow.disputeLostCount).toBe(1);

    // §85 (owner's decision): an override to BUYER_WINS orders the refund, like a first ruling
    // would — before, it only moved the counter and left the order where it was.
    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderRow.status).toBe('REFUND_ORDERED');

    const auditEntry = await app.prisma.auditLog.findFirst({ where: { action: 'DISPUTE_RULING_OVERRIDDEN', targetId: dispute.id } });
    expect(auditEntry).not.toBeNull();
  });

  it('overriding BUYER_WINS -> SHOP_WINS undoes the disputeLostCount +1', async () => {
    const app = getApp();
    const { superAdmin, adminA, sellerId, dispute } = await openDisputeScenario(app);
    await ruleDispute(adminA, dispute.id, 'BUYER_WINS', RULING_REASON);
    const afterFirst = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(afterFirst.disputeLostCount).toBe(1);

    const response = await overrideDispute(superAdmin, dispute.id, 'SHOP_WINS', 'ทบทวนแล้วร้านไม่ได้ทำผิด');
    expect(response.status).toBe(200);

    const afterOverride = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(afterOverride.disputeLostCount).toBe(0);
  });

  it('refuses to override a dispute that has never been ruled', async () => {
    const app = getApp();
    const { superAdmin, dispute } = await openDisputeScenario(app);

    const response = await overrideDispute(superAdmin, dispute.id, 'BUYER_WINS', RULING_REASON);
    expect(response.status).toBe(409);
  });
});

describe('#64 — I5: break-glass, only while the dispute is open, checked live', () => {
  it('reveals the full order (PII included) while open; closes the instant the dispute is ruled', async () => {
    const app = getApp();
    const { adminA, dispute } = await openDisputeScenario(app);

    const whileOpen = await breakGlass(adminA, dispute.id, 'ต้องตรวจสอบที่อยู่จัดส่งเทียบกับคำร้องเรียน');
    expect(whileOpen.status).toBe(200);
    const body = whileOpen.body as { order: { recipientName: string; phone: string }; paymentSlips: unknown[] };
    expect(body.order.recipientName).toBe('สมชาย ใจดี');
    expect(body.order.phone).toBe('0812345678');
    expect(body.paymentSlips.length).toBeGreaterThan(0);

    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    const afterClosed = await breakGlass(adminA, dispute.id, 'ต้องตรวจสอบที่อยู่จัดส่งเทียบกับคำร้องเรียน');
    expect(afterClosed.status).toBe(404);
  });

  it('requires a reason, and logs DISPUTE_IDENTITY_REVEALED with it', async () => {
    const app = getApp();
    const { adminA, dispute } = await openDisputeScenario(app);

    const noReason = await adminA.post(`/api/v1/disputes/${dispute.id}/break-glass`).set(CSRF_HEADER, await csrfToken(adminA)).send({});
    expect(noReason.status).toBe(400);

    const reason = 'ต้องตรวจสอบที่อยู่จัดส่งเทียบกับคำร้องเรียน';
    const response = await breakGlass(adminA, dispute.id, reason);
    expect(response.status).toBe(200);

    const entry = await app.prisma.auditLog.findFirst({ where: { action: 'DISPUTE_IDENTITY_REVEALED', targetId: dispute.id } });
    expect(entry?.reason).toBe(reason);
  });

  it('a cross-community admin cannot break-glass this dispute', async () => {
    const app = getApp();
    const { superAdmin, dispute } = await openDisputeScenario(app);
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const adminB = newClient(app);
    const adminBId = await registerVerified(app, adminB, 'admin-b@example.test');
    await assignAdmin(superAdmin, communityB, adminBId);

    const response = await breakGlass(adminB, dispute.id, 'พยายามดูข้อมูลออเดอร์ของร้านอื่น');
    expect(response.status).toBe(403);
  });

  it('an admin can read dispute evidence directly (no reveal reason needed) while open, refused once closed', async () => {
    const app = getApp();
    const { adminA, dispute } = await openDisputeScenario(app);
    const evidenceId = dispute.evidence[0]!.id;

    const whileOpen = await adminA.get(`/api/v1/disputes/${dispute.id}/admin-evidence/${evidenceId}`);
    expect(whileOpen.status).toBe(200);
    expect(whileOpen.headers['content-type']).toContain('image/jpeg');

    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    const afterClosed = await adminA.get(`/api/v1/disputes/${dispute.id}/admin-evidence/${evidenceId}`);
    expect(afterClosed.status).toBe(404);
  });
});

describe('code review of topic 10 — disputes (§85)', () => {
  async function communityOf(app: TestApp, shopId: string): Promise<string> {
    return (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).communityId;
  }
  async function lostCount(app: TestApp, sellerId: string): Promise<number> {
    return (await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } })).disputeLostCount;
  }
  async function respond(seller: Agent, orderId: string, text: string) {
    return seller.post(`${API}/shops/me/orders/${orderId}/dispute/respond`).set(CSRF_HEADER, await csrfToken(seller)).field('response', text);
  }
  async function createCarrier(superAdmin: Agent): Promise<string> {
    const response = await superAdmin.post(`${API}/shipping-carriers`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ name: 'Kerry' });
    return (response.body as { id: string }).id;
  }

  it('two admins ruling BUYER_WINS at once: one wins, the other gets 409, the shop owner loses one count, one audit entry with its community', async () => {
    const app = getApp();
    const { superAdmin, adminA, sellerId, shopId, dispute } = await openDisputeScenario(app);

    const results = await Promise.all([ruleDispute(adminA, dispute.id, 'BUYER_WINS', RULING_REASON), ruleDispute(superAdmin, dispute.id, 'BUYER_WINS', RULING_REASON)]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await lostCount(app, sellerId)).toBe(1);
    const entries = await app.prisma.auditLog.findMany({ where: { action: 'DISPUTE_RULED', targetId: dispute.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.communityId).toBe(await communityOf(app, shopId));
  });

  it('two identical overrides at once move disputeLostCount by one step, not two', async () => {
    const app = getApp();
    const { superAdmin, adminA, sellerId, dispute } = await openDisputeScenario(app);
    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    await Promise.all([
      overrideDispute(superAdmin, dispute.id, 'BUYER_WINS', 'ทบทวนแล้วเห็นว่าผู้ซื้อถูกต้อง'),
      overrideDispute(superAdmin, dispute.id, 'BUYER_WINS', 'ทบทวนแล้วเห็นว่าผู้ซื้อถูกต้อง'),
    ]);

    expect(await lostCount(app, sellerId)).toBe(1);
  });

  it('overriding SHOP_WINS to BUYER_WINS really orders the refund, like a first BUYER_WINS ruling would', async () => {
    const app = getApp();
    const { superAdmin, adminA, buyer, order, dispute } = await openDisputeScenario(app);
    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    const response = await overrideDispute(superAdmin, dispute.id, 'BUYER_WINS', 'ทบทวนแล้วเห็นว่าผู้ซื้อถูกต้อง');

    expect(response.status).toBe(200);
    expect(((await buyer.get(`${API}/orders/${order.id}`)).body as OrderBody).status).toBe('REFUND_ORDERED');
  });

  it('an admin who is the buyer on the order cannot rule their own dispute (N28)', async () => {
    const app = getApp();
    const { superAdmin, shopId, buyer, dispute } = await openDisputeScenario(app);
    const buyerId = ((await buyer.get(`${API}/auth/me`)).body as { id: string }).id;
    await assignAdmin(superAdmin, await communityOf(app, shopId), buyerId);

    const response = await ruleDispute(buyer, dispute.id, 'BUYER_WINS', RULING_REASON);

    expect(response.status).toBe(403);
  });

  it('break-glass and an admin’s look at the evidence are both audited with the community', async () => {
    const app = getApp();
    const { adminA, shopId, dispute } = await openDisputeScenario(app);
    await breakGlass(adminA, dispute.id, 'ต้องดูที่อยู่เพื่อเทียบกับหลักฐานการส่ง');
    const evidence = await adminA.get(`${API}/disputes/${dispute.id}/admin-evidence/${dispute.evidence[0]!.id}`);
    expect(evidence.status).toBe(200);

    const communityId = await communityOf(app, shopId);
    const revealed = await app.prisma.auditLog.findFirstOrThrow({ where: { action: 'DISPUTE_IDENTITY_REVEALED' } });
    expect(revealed.communityId).toBe(communityId);
    const viewed = await app.prisma.auditLog.findFirst({ where: { action: 'DISPUTE_EVIDENCE_VIEWED', targetId: dispute.id } });
    expect(viewed?.communityId).toBe(communityId);
  });

  it('evidence and a break-glass slip are served private, no-store and nosniff (§83)', async () => {
    const app = getApp();
    const { adminA, buyer, order, dispute } = await openDisputeScenario(app);
    const evidenceId = dispute.evidence[0]!.id;
    const slipId = ((await buyer.get(`${API}/orders/${order.id}/payment-slips`)).body as { id: string }[])[0]!.id;

    const responses = [
      await buyer.get(`${API}/disputes/${dispute.id}/evidence/${evidenceId}`),
      await adminA.get(`${API}/disputes/${dispute.id}/admin-evidence/${evidenceId}`),
      await adminA
        .post(`${API}/disputes/${dispute.id}/break-glass/payment-slips/${slipId}`)
        .set(CSRF_HEADER, await csrfToken(adminA))
        .send({ reason: 'ต้องเทียบยอดในสลิปกับยอดที่ผู้ซื้ออ้าง' }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('two shop responses at once: one lands, the other gets 409 instead of overwriting it', async () => {
    const app = getApp();
    const { seller, order } = await openDisputeScenario(app);

    const results = await Promise.all([respond(seller, order.id, 'คำตอบแรกของร้านค้าครับ'), respond(seller, order.id, 'คำตอบที่สองของร้านค้าครับ')]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it('the shop is told when a buyer opens a dispute — it is the side that has to answer', async () => {
    const app = getApp();
    const { seller, order } = await openDisputeScenario(app);

    const notes = (await seller.get(`${API}/notifications`)).body as { items: { type: string; targetId: string | null }[] };

    expect(notes.items).toContainEqual(expect.objectContaining({ type: 'DISPUTE_OPENED', targetId: order.id }));
  });

  it('a cancelled order the buyer had paid on can be disputed for 15 days after it was cancelled, not forever', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const placeAndLetExpire = async (buyerEmail: string) => {
      const buyer = newClient(app);
      await registerVerified(app, buyer, buyerEmail);
      const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
      await setShippingFee(seller, order.id, 2000);
      await uploadSlip(buyer, order.id);
      const slipId = ((await buyer.get(`${API}/orders/${order.id}/payment-slips`)).body as { id: string }[])[0]!.id;
      await seller
        .post(`${API}/shops/me/orders/${order.id}/payment-slips/${slipId}/reject`)
        .set(CSRF_HEADER, await csrfToken(seller))
        .send({ reason: 'ยอดโอนไม่ตรงกับยอดที่ต้องชำระ' });
      return { buyer, order };
    };
    const early = await placeAndLetExpire('early@example.test');
    const late = await placeAndLetExpire('late@example.test');
    app.clock.advanceByHours(25);
    await app.sweep.run();
    await login(early.buyer, 'early@example.test');
    expect(((await early.buyer.get(`${API}/orders/${early.order.id}`)).body as OrderBody).status).toBe('CANCELLED');

    const within = await openDispute(early.buyer, early.order.id, 'โอนเงินไปแล้วจริงแต่ร้านไม่ยอมรับสลิป');
    expect(within.id).toBeDefined();

    app.clock.advanceByDays(16);
    await login(late.buyer, 'late@example.test');
    const after = await late.buyer
      .post(`${API}/orders/${late.order.id}/dispute`)
      .set(CSRF_HEADER, await csrfToken(late.buyer))
      .field('reason', 'โอนเงินไปแล้วจริงแต่ร้านไม่ยอมรับสลิป')
      .attach('files', await aJpegBuffer(), 'evidence.jpg');
    expect(after.status).toBe(409);
  });

  it('after closing and reopening, the owner still answers a dispute on the old shop’s order and uploads its refund slip', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const carrierId = await createCarrier(superAdmin);
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);
    await seller.post(`${API}/shops/me/orders/${order.id}/confirm-payment`).set(CSRF_HEADER, await csrfToken(seller));
    await seller.post(`${API}/shops/me/orders/${order.id}/ship`).set(CSRF_HEADER, await csrfToken(seller)).send({ shippingCarrierId: carrierId, trackingNumber: 'TH1234567890' });
    expect((await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller))).status).toBe(200);
    const otherCommunity = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    await seller.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(seller)).send({ communityId: otherCommunity, name: 'ร้านใหม่' });
    const dispute = await openDispute(buyer, order.id, 'ของไม่ถึงมือเลยครับ ติดตามพัสดุไม่ได้');

    expect((await respond(seller, order.id, 'ร้านส่งของไปแล้วจริง มีหลักฐานการส่ง')).status).toBe(200);
    await ruleDispute(superAdmin, dispute.id, 'BUYER_WINS', RULING_REASON);
    const refundSlip = await seller
      .post(`${API}/shops/me/orders/${order.id}/refund-slips`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', await aJpegBuffer(), 'refund.jpg');
    expect(refundSlip.status).toBe(201);
  });
});
