import { vi } from 'vitest';
import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { OrderStockAdjustmentPort } from '../src/order/ports/order-stock-adjustment.port.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #62 (I4/I4b/I5): a community admin's only decision about a frozen order (release or
 * terminate, system picks the destination), the masked read that decision is made from, and
 * unsuspending a shop auto-unfreezing what an admin hasn't individually ruled on yet.
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

async function placeOrderOk(app: TestApp, buyer: Agent, variantId: string, quantity = 1): Promise<OrderBody> {
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity });
  const response = await checkoutAsShown(buyer, addressId);

  return (response.body as OrderBody[])[0]!;
}

async function ban(client: Agent, userId: string, reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง') {
  return client
    .post(`${API}/admin/users/${userId}/ban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function suspend(client: Agent, shopId: string, reason = 'เหตุผลสำหรับทดสอบการระงับร้าน') {
  return client
    .post(`${API}/shops/${shopId}/suspend`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function unsuspend(client: Agent, shopId: string) {
  return client.post(`${API}/shops/${shopId}/unsuspend`).set(CSRF_HEADER, await csrfToken(client));
}

async function adminView(client: Agent, orderId: string) {
  return client.get(`${API}/orders/${orderId}/admin-view`);
}

async function rule(client: Agent, orderId: string, body: Record<string, unknown>) {
  return client
    .post(`${API}/orders/${orderId}/freeze-ruling`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send(body);
}

const REASON = 'ตรวจสอบข้อเท็จจริงครบถ้วนแล้วจึงตัดสินใจตามนี้';

/** A frozen order + the community admin who may rule on it. */
async function frozenOrderWithAdmin(app: TestApp): Promise<{
  superAdmin: Agent;
  adminA: Agent;
  seller: Agent;
  sellerId: string;
  buyer: Agent;
  order: OrderBody;
}> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

  const adminA = newClient(app);
  const adminAId = await registerVerified(app, adminA, ADMIN_A);
  await assignAdmin(superAdmin, communityId, adminAId);

  const { seller, sellerId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrderOk(app, buyer, product.variants[0]!.id);

  await ban(superAdmin, sellerId);

  return { superAdmin, adminA, seller, sellerId, buyer, order };
}

describe('#62 — I5: the masked admin view never carries PII', () => {
  it('shows items/amounts/status/freeze reasons/hasPaymentSlip — never name, address, phone', async () => {
    const app = getApp();
    const { adminA, order } = await frozenOrderWithAdmin(app);

    const response = await adminView(adminA, order.id);
    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;

    expect(body.status).toBe('AWAITING_SHIPPING_QUOTE');
    expect(body.frozenAt).not.toBeNull();
    expect(body.freezeReasons).toEqual(['SELLER_BANNED']);
    expect(body.hasPaymentSlip).toBe(false);
    expect(Array.isArray(body.items)).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('สมชาย ใจดี'); // recipientName
    expect(serialized).not.toContain('0812345678'); // phone
    expect(body).not.toHaveProperty('recipientName');
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('houseNumber');
  });

  it('refuses a community admin from a different community', async () => {
    const app = getApp();
    const { superAdmin, order } = await frozenOrderWithAdmin(app);
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const adminB = newClient(app);
    const adminBId = await registerVerified(app, adminB, 'admin-b@example.test');
    await assignAdmin(superAdmin, communityB, adminBId);

    const response = await adminView(adminB, order.id);
    expect(response.status).toBe(403);
  });

  it('super admin sees a real 404 for a nonexistent order; a community admin gets 403', async () => {
    const app = getApp();
    const { superAdmin, adminA } = await frozenOrderWithAdmin(app);
    const fakeId = '01912d2f-0000-7000-8000-000000000000';

    const bySuper = await adminView(superAdmin, fakeId);
    expect(bySuper.status).toBe(404);

    const byAdmin = await adminView(adminA, fakeId);
    expect(byAdmin.status).toBe(403);
  });
});

describe('#62 — I4: release or terminate, never a caller-picked destination', () => {
  it('RELEASE unfreezes and leaves the order exactly where it was', async () => {
    const app = getApp();
    const { adminA, order } = await frozenOrderWithAdmin(app);

    const response = await rule(adminA, order.id, { verdict: 'RELEASE', reason: REASON });
    expect(response.status).toBe(204);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.frozenAt).toBeNull();
    expect(row.status).toBe('AWAITING_SHIPPING_QUOTE');

    const reasons = await app.prisma.orderFreezeReason.findMany({ where: { orderId: order.id } });
    expect(reasons).toHaveLength(0);
  });

  it('TERMINATE on an unpaid order cancels it — cancelledBy ADMIN (the reservation release itself is proven in order-freeze.spec.ts)', async () => {
    const app = getApp();
    const { adminA, order } = await frozenOrderWithAdmin(app);

    const response = await rule(adminA, order.id, { verdict: 'TERMINATE', reason: REASON });
    expect(response.status).toBe(204);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelledBy).toBe('ADMIN');
    expect(row.frozenAt).toBeNull();
  });

  it('TERMINATE on a paid order moves it to REFUND_ORDERED and fires the I7 stock-adjustment notice', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const adminA = newClient(app);
    await assignAdmin(superAdmin, communityId, await registerVerified(app, adminA, ADMIN_A));
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id);
    await seller.post(`${API}/shops/me/orders/${order.id}/shipping-fee`).set(CSRF_HEADER, await csrfToken(seller)).send({ shippingAmountMinor: 2000 });
    await buyer
      .post(`${API}/orders/${order.id}/payment-slips`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer(), 'slip.jpg');
    expect((await seller.post(`${API}/shops/me/orders/${order.id}/confirm-payment`).set(CSRF_HEADER, await csrfToken(seller))).status).toBe(200);
    await suspend(superAdmin, shopId);
    const notify = vi.spyOn(app.app.get(OrderStockAdjustmentPort), 'notify');

    const response = await rule(adminA, order.id, { verdict: 'TERMINATE', reason: REASON });
    expect(response.status).toBe(204);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('REFUND_ORDERED');
    expect(row.frozenAt).toBeNull();
    expect(notify).toHaveBeenCalledExactlyOnceWith(order.id);
  });

  it('🚨 an admin who sends a destination gets refused, not obeyed', async () => {
    const app = getApp();
    const { adminA, order } = await frozenOrderWithAdmin(app);

    const response = await rule(adminA, order.id, { verdict: 'TERMINATE', reason: REASON, destination: 'CANCELLED' });
    expect(response.status).toBe(400);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.frozenAt).not.toBeNull(); // nothing happened
  });

  it('refuses without a reason, and refuses an order that is not frozen', async () => {
    const app = getApp();
    const { adminA, order } = await frozenOrderWithAdmin(app);

    const noReason = await rule(adminA, order.id, { verdict: 'RELEASE' });
    expect(noReason.status).toBe(400);

    const released = await rule(adminA, order.id, { verdict: 'RELEASE', reason: REASON });
    expect(released.status).toBe(204);

    const ruledAgain = await rule(adminA, order.id, { verdict: 'RELEASE', reason: REASON });
    expect(ruledAgain.status).toBe(409);
  });

  it('records a FROZEN_ORDER_RULED audit entry naming the verdict', async () => {
    const app = getApp();
    const { adminA, order } = await frozenOrderWithAdmin(app);
    const adminAId = await app.prisma.user.findUniqueOrThrow({ where: { email: ADMIN_A }, select: { id: true } }).then((u) => u.id);

    await rule(adminA, order.id, { verdict: 'TERMINATE', reason: REASON });

    const entry = await app.prisma.auditLog.findFirst({ where: { action: 'FROZEN_ORDER_RULED', targetId: order.id } });
    expect(entry).not.toBeNull();
    expect(entry?.actorUserId).toBe(adminAId);
    expect(entry?.reason).toContain('TERMINATE');
  });
});

describe('#62 — I4b: unsuspending a shop auto-unfreezes what nobody has individually ruled on', () => {
  it('unfreezes an order frozen only by the suspension; leaves a doubly-frozen order still frozen', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);

    const buyer1 = newClient(app);
    const buyer1Id = await registerVerified(app, buyer1, BUYER);
    const order1 = await placeOrderOk(app, buyer1, product.variants[0]!.id);

    const buyer2 = newClient(app);
    await registerVerified(app, buyer2, 'buyer2@example.test');
    const order2 = await placeOrderOk(app, buyer2, product.variants[0]!.id);

    await suspend(superAdmin, shopId); // freezes both orders: SHOP_SUSPENDED
    await ban(superAdmin, buyer1Id); // order1 also gets BUYER_BANNED

    const unsuspendResponse = await unsuspend(superAdmin, shopId);
    expect(unsuspendResponse.status).toBe(200);

    const row1 = await app.prisma.order.findUniqueOrThrow({ where: { id: order1.id } });
    expect(row1.frozenAt).not.toBeNull(); // BUYER_BANNED still holds it
    const reasons1 = await app.prisma.orderFreezeReason.findMany({ where: { orderId: order1.id } });
    expect(reasons1.map((r) => r.reason)).toEqual(['BUYER_BANNED']);

    const row2 = await app.prisma.order.findUniqueOrThrow({ where: { id: order2.id } });
    expect(row2.frozenAt).toBeNull(); // only ever had SHOP_SUSPENDED — now fully unfrozen
  });

  it('does not disturb an order an admin already ruled on individually', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id);

    await suspend(superAdmin, shopId);
    const releaseResponse = await rule(superAdmin, order.id, { verdict: 'RELEASE', reason: REASON });
    expect(releaseResponse.status).toBe(204);

    const beforeCount = await app.prisma.auditLog.count({ where: { action: 'ORDER_UNFROZEN', targetId: order.id } });
    expect(beforeCount).toBe(1); // from the manual release

    await unsuspend(superAdmin, shopId);

    const afterCount = await app.prisma.auditLog.count({ where: { action: 'ORDER_UNFROZEN', targetId: order.id } });
    expect(afterCount).toBe(1); // unsuspend found nothing left to unfreeze — no second entry

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.frozenAt).toBeNull();
    expect(row.status).toBe('AWAITING_SHIPPING_QUOTE');
  });
});

describe('code review of topic 10 — frozen orders (§85)', () => {
  async function jpeg(): Promise<Buffer> {
    return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
  }

  /** A slip is up (PAYMENT_SUBMITTED), then the shop is suspended — frozen, but the seller can still act (J2). */
  async function slipUpThenSuspended(app: TestApp) {
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const adminA = newClient(app);
    await assignAdmin(superAdmin, communityId, await registerVerified(app, adminA, ADMIN_A));
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const order = await placeOrderOk(app, buyer, product.variants[0]!.id);
    await seller.post(`${API}/shops/me/orders/${order.id}/shipping-fee`).set(CSRF_HEADER, await csrfToken(seller)).send({ shippingAmountMinor: 2000 });
    await buyer.post(`${API}/orders/${order.id}/payment-slips`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await jpeg(), 'slip.jpg');
    await suspend(superAdmin, shopId);

    return { superAdmin, adminA, seller, shopId, communityId, buyer, buyerId, order };
  }

  it('TERMINATE on an order whose slip is already up orders a refund instead of cancelling it (I4) — and says so, not "continue as normal"', async () => {
    const app = getApp();
    const { adminA, seller, buyer, order } = await slipUpThenSuspended(app);

    const response = await rule(adminA, order.id, { verdict: 'TERMINATE', reason: REASON });

    expect(response.status).toBe(204);
    expect(((await buyer.get(`${API}/orders/${order.id}`)).body as OrderBody).status).toBe('REFUND_ORDERED');
    const buyerNotes = (await buyer.get(`${API}/notifications`)).body as { items: { type: string; message: string }[] };
    expect(buyerNotes.items.map((note) => note.type)).toContain('ORDER_TERMINATED');
    expect(buyerNotes.items.some((note) => note.message.includes('ดำเนินการต่อได้ตามปกติ'))).toBe(false);
    const shopNotes = (await seller.get(`${API}/notifications`)).body as { items: { type: string }[] };
    expect(shopNotes.items.map((note) => note.type)).toContain('ORDER_TERMINATED');
  });

  it('TERMINATE racing the shop’s confirm-payment never cancels an order whose money the shop just confirmed', async () => {
    const app = getApp();
    const { adminA, seller, order } = await slipUpThenSuspended(app);
    const notify = vi.spyOn(app.app.get(OrderStockAdjustmentPort), 'notify');
    const original = app.prisma.order.findUnique.bind(app.prisma.order);
    let confirmed = 0;
    vi.spyOn(app.prisma.order, 'findUnique').mockImplementation((async (args: { select?: { frozenAt?: boolean } }) => {
      const read = await original(args as never);
      if (confirmed === 0 && args.select?.frozenAt === true) {
        confirmed = (await seller.post(`${API}/shops/me/orders/${order.id}/confirm-payment`).set(CSRF_HEADER, await csrfToken(seller))).status;
      }
      return read;
    }) as never);

    const response = await rule(adminA, order.id, { verdict: 'TERMINATE', reason: REASON });

    expect(confirmed).toBe(200);
    expect(response.status).toBe(204);
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('REFUND_ORDERED');
    expect(notify).toHaveBeenCalledExactlyOnceWith(order.id);
  });

  it('🚨 a community admin of another community cannot rule on this frozen order', async () => {
    const app = getApp();
    const { superAdmin, order } = await slipUpThenSuspended(app);
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const adminB = newClient(app);
    await assignAdmin(superAdmin, communityB, await registerVerified(app, adminB, 'admin-b@example.test'));

    const response = await rule(adminB, order.id, { verdict: 'TERMINATE', reason: REASON });

    expect(response.status).toBe(403);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).frozenAt).not.toBeNull();
  });

  it('an admin who is the order’s own buyer cannot rule on it (N28)', async () => {
    const app = getApp();
    const { superAdmin, communityId, buyer, buyerId, order } = await slipUpThenSuspended(app);
    await assignAdmin(superAdmin, communityId, buyerId);

    const response = await rule(buyer, order.id, { verdict: 'TERMINATE', reason: REASON });

    expect(response.status).toBe(403);
  });

  it('freeze, ruling and unfreeze audit entries all carry the community, and the unfreeze says why', async () => {
    const app = getApp();
    const { adminA, communityId, order } = await slipUpThenSuspended(app);
    await rule(adminA, order.id, { verdict: 'RELEASE', reason: REASON });

    for (const action of ['ORDER_FROZEN', 'FROZEN_ORDER_RULED', 'ORDER_UNFROZEN'] as const) {
      const entry = await app.prisma.auditLog.findFirstOrThrow({ where: { action, targetId: order.id } });
      expect(entry.communityId).toBe(communityId);
      if (action === 'ORDER_UNFROZEN') {
        expect(entry.reason).not.toBeNull();
      }
    }
  });
});
