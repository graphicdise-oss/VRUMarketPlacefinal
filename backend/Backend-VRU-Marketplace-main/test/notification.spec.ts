import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { OrderStockAdjustmentPort } from '../src/order/ports/order-stock-adjustment.port.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct, approveShopAs } from './helpers/review.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #69: `Notification` always in-app, email only for I17's own list (deadline warnings, dispute
 * outcome, refund-ordered-auto, a shop's refund slip). Follows M5 throughout — arrange over HTTP,
 * move the clock and call `sweep.run()` directly for anything clock-driven, assert over HTTP
 * (`GET /notifications`) or via `app.email` (not a third seam, per M5) for the email half.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
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
}
interface NotificationBody {
  id: string;
  type: string;
  message: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  readAt: string | null;
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

async function uploadPaymentSlip(buyer: Agent, orderId: string): Promise<void> {
  await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
}

async function uploadRefundSlip(seller: Agent, orderId: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/refund-slips`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .attach('file', await aJpegBuffer(), 'refund-slip.jpg');
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

async function ban(client: Agent, userId: string, reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง') {
  return client.post(`${API}/admin/users/${userId}/ban`).set(CSRF_HEADER, await csrfToken(client)).send({ reason });
}

async function unban(client: Agent, userId: string) {
  return client.post(`${API}/admin/users/${userId}/unban`).set(CSRF_HEADER, await csrfToken(client)).send({});
}

async function suspend(client: Agent, shopId: string, reason = 'เหตุผลสำหรับทดสอบการระงับร้าน') {
  return client.post(`${API}/shops/${shopId}/suspend`).set(CSRF_HEADER, await csrfToken(client)).send({ reason });
}

async function unsuspend(client: Agent, shopId: string) {
  return client.post(`${API}/shops/${shopId}/unsuspend`).set(CSRF_HEADER, await csrfToken(client));
}

async function ruleFrozenOrder(client: Agent, orderId: string, body: Record<string, unknown>) {
  return client.post(`${API}/orders/${orderId}/freeze-ruling`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

async function notificationsFor(client: Agent, email: string): Promise<NotificationBody[]> {
  await login(client, email);
  const response = await client.get(`${API}/notifications`);

  return (response.body as { items: NotificationBody[] }).items;
}

async function unreadCountFor(client: Agent, email: string): Promise<number> {
  await login(client, email);
  const response = await client.get(`${API}/notifications/unread-count`);

  return (response.body as { count: number }).count;
}

/** A community, an approved shop and product, and a fresh unquoted order. */
async function freshOrder(app: TestApp): Promise<{ superAdmin: Agent; seller: Agent; sellerId: string; shopId: string; buyer: Agent; buyerId: string; order: OrderBody; variantId: string }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบแจ้งเตือน', 10000, 5);
  const variantId = product.variants[0]!.id;
  const buyer = newClient(app);
  const buyerId = await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, variantId, 1);

  return { superAdmin, seller, sellerId, shopId, buyer, buyerId, order, variantId };
}

describe('#69 — ordinary status changes are in-app only, never an email (I17)', () => {
  it('shop setting the shipping fee notifies the buyer in-app, and sends no email at all', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    app.email.clear(); // freshOrder's own registrations already sent verification emails

    const response = await setShippingFee(seller, order.id, 3000);
    expect(response.status).toBe(200);

    const notifications = await notificationsFor(buyer, BUYER);
    expect(notifications.some((n) => n.type === 'ORDER_SHIPPING_FEE_SET' && n.targetId === order.id)).toBe(true);
    expect(app.email.sent).toHaveLength(0);
  });

  it('slip rejection and payment confirmation are in-app only too — several ordinary events, zero emails', async () => {
    const app = getApp();
    const { superAdmin, seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 3000);
    await uploadPaymentSlip(buyer, order.id);
    const carrierResponse = await superAdmin
      .post(`${API}/shipping-carriers`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ name: 'Kerry' });
    const carrierId = (carrierResponse.body as { id: string }).id;
    app.email.clear(); // registrations + carrier setup already sent/would-have-sent unrelated mail

    const slips = await app.prisma.paymentSlip.findMany({ where: { orderId: order.id } });
    await seller
      .post(`${API}/shops/me/orders/${order.id}/payment-slips/${slips[0]!.id}/reject`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ reason: 'ยอดโอนไม่ตรงกับยอดที่ต้องชำระ' });
    await uploadPaymentSlip(buyer, order.id);
    const confirmed = await seller.post(`${API}/shops/me/orders/${order.id}/confirm-payment`).set(CSRF_HEADER, await csrfToken(seller));
    expect(confirmed.status).toBe(200);
    const shipped = await seller
      .post(`${API}/shops/me/orders/${order.id}/ship`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ shippingCarrierId: carrierId, trackingNumber: 'TH123456789' });
    expect(shipped.status).toBe(200);

    const notifications = await notificationsFor(buyer, BUYER);
    const types = notifications.map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['ORDER_SLIP_REJECTED', 'ORDER_PAYMENT_CONFIRMED', 'ORDER_SHIPPED']));
    expect(app.email.sent).toHaveLength(0);
  });
});

describe('#69 — deadline warnings (I17): in-app + DEADLINE_WARNING email, once only', () => {
  it('clock 1 (shop must quote shipping) warns the shop at 18h, both in-app and by email', async () => {
    const app = getApp();
    const { seller, sellerId, order } = await freshOrder(app);
    const sellerEmail = (await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } })).email;

    app.clock.advanceByHours(18);
    await app.sweep.run();
    await app.sweep.run(); // a second pass must not double-send

    const notifications = await notificationsFor(seller, SELLER);
    expect(notifications.filter((n) => n.type === 'ORDER_DEADLINE_WARNING_SHIPPING_QUOTE' && n.targetId === order.id)).toHaveLength(1);
    const emails = app.email.ofKind('DEADLINE_WARNING').filter((m) => m.to === sellerEmail);
    expect(emails).toHaveLength(1);
  });

  it('clock 2 (buyer must pay) warns the buyer, not the shop', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 3000);

    app.clock.advanceByHours(18);
    await app.sweep.run();

    const buyerNotifications = await notificationsFor(buyer, BUYER);
    expect(buyerNotifications.some((n) => n.type === 'ORDER_DEADLINE_WARNING_PAYMENT')).toBe(true);
    const sellerNotifications = await notificationsFor(seller, SELLER);
    expect(sellerNotifications.some((n) => n.type === 'ORDER_DEADLINE_WARNING_PAYMENT')).toBe(false);
    expect(app.email.ofKind('DEADLINE_WARNING')).toHaveLength(1);
  });

  it('clock 3 (shop must confirm payment) warns the shop, with I17’s longer 24h lead', async () => {
    const app = getApp();
    const { seller, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    await app.prisma.order.update({
      where: { id: order.id },
      data: { status: 'PAYMENT_SUBMITTED', paymentConfirmationWindowStartedAt: app.clock.now() },
    });

    app.clock.advanceByDays(2); // 48h in — exactly 24h left on a 3-day clock
    await app.sweep.run();

    const notifications = await notificationsFor(seller, SELLER);
    expect(notifications.some((n) => n.type === 'ORDER_DEADLINE_WARNING_PAYMENT_CONFIRMATION')).toBe(true);
    expect(app.email.ofKind('DEADLINE_WARNING')).toHaveLength(1);
  });
});

describe('#69 (I7) — a stock-adjustment notice for the shop, in-app only', () => {
  it('TERMINATE on a paid, frozen order notifies the shop owner, no email', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const adminA = newClient(app);
    const adminAId = await registerVerified(app, adminA, ADMIN_A);
    await assignAdmin(superAdmin, communityId, adminAId);
    const { seller, sellerId, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ I7', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id);
    await ban(superAdmin, sellerId); // freezes every non-terminal order this shop is selling — and locks the seller out of logging in
    await app.prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', sellerConfirmedAt: app.clock.now() } });
    const notify = vi.spyOn(app.app.get(OrderStockAdjustmentPort), 'notify');
    app.email.clear();

    const response = await ruleFrozenOrder(adminA, order.id, { verdict: 'TERMINATE', reason: 'ตรวจสอบข้อเท็จจริงครบถ้วนแล้วจึงตัดสินใจตามนี้' });
    expect(response.status).toBe(204);
    expect(notify).toHaveBeenCalledExactlyOnceWith(order.id);

    // The seller is banned and cannot log in to read this over HTTP — read the row directly, the
    // same way every other spec reads final DB state for an assertion (never to *perform* the
    // action under test, which stays entirely over HTTP/WebSocket per M5).
    const notifications = await app.prisma.notification.findMany({ where: { userId: sellerId } });
    expect(notifications.some((n) => n.type === 'ORDER_STOCK_ADJUST_NEEDED' && n.targetId === order.id)).toBe(true);
    expect(app.email.sent).toHaveLength(0);
    void seller;
    void shopId;
  });
});

describe('#69 (K12) — dispute rulings notify both parties, in-app + DISPUTE_OUTCOME email', () => {
  async function openDisputeScenario(app: TestApp) {
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
    const buyerId = await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    const dispute = await openDispute(buyer, order.id, 'สินค้าที่ได้รับไม่ตรงกับที่สั่งเลยครับ');

    return { adminA, seller, sellerId, shopId, buyer, buyerId, order, dispute };
  }

  it('BUYER_WINS notifies the buyer and the shop, both with an email', async () => {
    const app = getApp();
    const { adminA, seller, sellerId, buyer, buyerId, dispute } = await openDisputeScenario(app);
    const buyerEmail = (await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } })).email;
    const sellerEmail = (await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } })).email;

    const response = await ruleDispute(adminA, dispute.id, 'BUYER_WINS', 'หลักฐานชัดเจนว่าผู้ซื้อเป็นฝ่ายถูก');
    expect(response.status).toBe(200);

    const buyerNotifications = await notificationsFor(buyer, BUYER);
    expect(buyerNotifications.some((n) => n.type === 'DISPUTE_RULED' && n.targetId === dispute.id)).toBe(true);
    const sellerNotifications = await notificationsFor(seller, SELLER);
    expect(sellerNotifications.some((n) => n.type === 'DISPUTE_RULED' && n.targetId === dispute.id)).toBe(true);

    const outcomeEmails = app.email.ofKind('DISPUTE_OUTCOME');
    expect(outcomeEmails.map((m) => m.to).sort()).toEqual([buyerEmail, sellerEmail].sort());
  });

  it('a failed email never fails the ruling itself — the transaction still commits (#69’s own AC)', async () => {
    const app = getApp();
    const { adminA, dispute, order } = await openDisputeScenario(app);
    app.email.failNextSends('smtp down for the test');

    const response = await ruleDispute(adminA, dispute.id, 'SHOP_WINS', 'หลักฐานร้านหนักแน่นกว่า');
    expect(response.status).toBe(200);
    expect((response.body as DisputeBody).verdict).toBe('SHOP_WINS');

    const row = await app.prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(row.verdict).toBe('SHOP_WINS');
    expect(row.closedAt).not.toBeNull();
    void order;
    // The email attempts are still recorded (retryable failure), but nothing threw.
    expect(app.email.sent.length).toBeGreaterThan(0);
  });
});

describe('#69 (K11) — a shop’s refund slip notifies the buyer, in-app + email', () => {
  it('uploading a refund slip notifies the buyer with an ORDER_STATUS email', async () => {
    const app = getApp();
    const { seller, buyer, buyerId, order } = await freshOrder(app);
    const buyerEmail = (await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } })).email;
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    app.clock.advanceByDays(3);
    await app.sweep.run(); // clock 3 timeout → REFUND_ORDERED
    await login(seller, SELLER);

    const uploaded = await uploadRefundSlip(seller, order.id);
    expect(uploaded.status).toBe(201);

    const buyerNotifications = await notificationsFor(buyer, BUYER);
    expect(buyerNotifications.some((n) => n.type === 'REFUND_SLIP_UPLOADED' && n.targetId === order.id)).toBe(true);
    const statusEmails = app.email.ofKind('ORDER_STATUS').filter((m) => m.to === buyerEmail);
    // At least one: the refund slip's own email. (The auto-REFUND_ORDERED transition above also
    // fires an ORDER_STATUS email to the same address — see the next describe block.)
    expect(statusEmails.length).toBeGreaterThanOrEqual(1);
  });
});

describe('#69 (I1/I17) — REFUND_ORDERED by clock-3 timeout notifies both parties with email', () => {
  it('notifies buyer and shop, both with an ORDER_STATUS email, the moment the sweep converts the order', async () => {
    const app = getApp();
    const { seller, sellerId, buyer, buyerId, order } = await freshOrder(app);
    const buyerEmail = (await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } })).email;
    const sellerEmail = (await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } })).email;
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);

    app.clock.advanceByDays(3);
    const report = await app.sweep.run();
    expect(report.outcomes).toContainEqual({ name: 'orders.expirePaymentConfirmation', handled: 1, failed: false });

    const buyerNotifications = await notificationsFor(buyer, BUYER);
    expect(buyerNotifications.some((n) => n.type === 'ORDER_REFUND_ORDERED_AUTO' && n.targetId === order.id)).toBe(true);
    const sellerNotifications = await notificationsFor(seller, SELLER);
    expect(sellerNotifications.some((n) => n.type === 'ORDER_REFUND_ORDERED_AUTO' && n.targetId === order.id)).toBe(true);

    const statusEmails = app.email.ofKind('ORDER_STATUS').map((m) => m.to);
    expect(statusEmails).toEqual(expect.arrayContaining([buyerEmail, sellerEmail]));

    // Sweeping again must not double-send.
    app.email.clear();
    await app.sweep.run();
    expect(app.email.sent).toHaveLength(0);
  });
});

describe('#69 — order frozen/unfrozen notifies the buyer, in-app only', () => {
  it('banning the seller freezes the buyer’s order and notifies them; unbanning unfreezes and notifies again', async () => {
    const app = getApp();
    const { superAdmin, sellerId, buyer, order } = await freshOrder(app);
    app.email.clear();

    await ban(superAdmin, sellerId);
    const afterFreeze = await notificationsFor(buyer, BUYER);
    expect(afterFreeze.some((n) => n.type === 'ORDER_FROZEN' && n.targetId === order.id)).toBe(true);

    await unban(superAdmin, sellerId);
    const afterUnfreeze = await notificationsFor(buyer, BUYER);
    expect(afterUnfreeze.some((n) => n.type === 'ORDER_UNFROZEN' && n.targetId === order.id)).toBe(true);
    expect(app.email.sent).toHaveLength(0);
  });
});

describe('#69 — product moderation and shop status notify the shop owner, in-app only', () => {
  it('product approval and shop suspension/unsuspension all land as in-app notifications for the owner', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    app.email.clear();

    // sellerWithShop already force-approves the shop via Prisma — reset to PENDING to exercise
    // the real HTTP approval path and its notification.
    await app.prisma.shop.update({ where: { id: shopId }, data: { approvalStatus: 'PENDING' } });
    const approveShop = await approveShopAs(superAdmin, shopId);
    expect(approveShop.status).toBe(200);

    const created = await seller
      .post(`${API}/products`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'สินค้าทดสอบแจ้งเตือน', description: 'คำอธิบาย', categoryId, variants: [{ name: 'แบบเดียว', priceAmountMinor: 5000, stock: 3 }] });
    const productId = (created.body as { id: string }).id;
    await approveProduct(superAdmin, productId);

    await suspend(superAdmin, shopId);
    await unsuspend(superAdmin, shopId);

    const notifications = await notificationsFor(seller, SELLER);
    const types = notifications.map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['SHOP_APPROVED', 'PRODUCT_APPROVED', 'SHOP_SUSPENDED', 'SHOP_UNSUSPENDED']));
    expect(app.email.sent).toHaveLength(0);
  });
});

interface RoomBody {
  id: string;
}
interface MessageBody {
  id: string;
  roomId: string;
}
type AckResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string } };

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: AckResponse<T>) => resolve(response));
  });
}

describe('#69 — a new chat message notifies the other party, in-app only (I17)', () => {
  it('notifies the recipient, never the sender, and sends no email', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    app.email.clear();

    const socket = chatSocket(app, buyer);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error: Error) => reject(error));
      socket.connect();
    });
    const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    if (!opened.ok) {
      throw new Error(`openRoomWithShop failed: ${opened.error.code}`);
    }
    const roomId = opened.data.id;
    const sent = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'มีสินค้าตัวนี้ไหมครับ' });
    expect(sent.ok).toBe(true);
    socket.disconnect();

    const sellerNotifications = await notificationsFor(seller, SELLER);
    expect(sellerNotifications.some((n) => n.type === 'CHAT_MESSAGE' && n.targetId === roomId)).toBe(true);
    const buyerNotifications = await notificationsFor(buyer, BUYER);
    expect(buyerNotifications.some((n) => n.type === 'CHAT_MESSAGE')).toBe(false); // never the sender
    expect(app.email.sent).toHaveLength(0);
  });
});

describe('#69 — isolation, unread count, and mark-all-read', () => {
  it('one user never sees another user’s notifications', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 3000); // notifies the buyer only

    const sellerNotifications = await notificationsFor(seller, SELLER);
    expect(sellerNotifications.some((n) => n.targetId === order.id && n.type === 'ORDER_SHIPPING_FEE_SET')).toBe(false);
    const buyerNotifications = await notificationsFor(buyer, BUYER);
    expect(buyerNotifications.some((n) => n.targetId === order.id && n.type === 'ORDER_SHIPPING_FEE_SET')).toBe(true);
  });

  it('unread count matches, and marking all read zeroes it out', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 3000);
    await uploadPaymentSlip(buyer, order.id);
    const slips = await app.prisma.paymentSlip.findMany({ where: { orderId: order.id } });
    await seller
      .post(`${API}/shops/me/orders/${order.id}/payment-slips/${slips[0]!.id}/reject`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ reason: 'สลิปไม่ชัดเจน' });

    const before = await unreadCountFor(buyer, BUYER);
    expect(before).toBeGreaterThanOrEqual(2);

    const markAll = await buyer.post(`${API}/notifications/read-all`).set(CSRF_HEADER, await csrfToken(buyer));
    expect(markAll.status).toBe(204);

    const after = await unreadCountFor(buyer, BUYER);
    expect(after).toBe(0);
    const notifications = await notificationsFor(buyer, BUYER);
    expect(notifications.every((n) => n.readAt !== null)).toBe(true);
  });
});

describe('#69 (L7) — 180-day retention, through the one sweep point', () => {
  it('purges rows older than 180 days, and a second sweep pass handles nothing new', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    // §84: a real notification, raised over HTTP — this test used to insert a row through Prisma
    // with a hand-set `createdAt`, which is how it never noticed that every real row took its
    // timestamp from the database clock instead of `Clock`, and so never aged under seam 2.
    await setShippingFee(seller, order.id, 2000);
    expect((await notificationsFor(buyer, BUYER)).some((n) => n.type === 'ORDER_SHIPPING_FEE_SET')).toBe(true);
    const countBefore = await app.prisma.notification.count();

    app.clock.advanceByDays(179);
    const tooSoon = await app.sweep.run();
    expect(tooSoon.outcomes).toContainEqual({ name: 'notifications.purgeOld', handled: 0, failed: false });

    app.clock.advanceByDays(1); // total 180 days
    const first = await app.sweep.run();
    const purged = first.outcomes.find((o) => o.name === 'notifications.purgeOld');
    expect(purged?.failed).toBe(false);
    expect(purged?.handled).toBeGreaterThanOrEqual(countBefore);
    expect((await notificationsFor(buyer, BUYER)).some((n) => n.type === 'ORDER_SHIPPING_FEE_SET')).toBe(false);

    const second = await app.sweep.run();
    expect(second.outcomes).toContainEqual({ name: 'notifications.purgeOld', handled: 0, failed: false });
  });
});

describe('code review of topic 12 (§84)', () => {
  it('a notification’s createdAt is the application’s Clock, not the database’s own now()', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);

    const fee = (await notificationsFor(buyer, BUYER)).find((n) => n.type === 'ORDER_SHIPPING_FEE_SET');

    expect(fee?.createdAt).toBe(app.clock.now().toISOString());
  });

  it('🚨 an email sender that throws never fails a request that already committed (#69’s own AC)', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    app.clock.advanceByDays(3);
    await app.sweep.run(); // clock 3 timeout → REFUND_ORDERED
    await login(seller, SELLER);
    vi.spyOn(app.email, 'send').mockRejectedValue(new Error('Brevo unreachable'));

    const uploaded = await uploadRefundSlip(seller, order.id);

    expect(uploaded.status).toBe(201);
    expect((await notificationsFor(buyer, BUYER)).some((n) => n.type === 'REFUND_SLIP_UPLOADED')).toBe(true);
  });

  it('an email sender that throws is logged by the error’s kind, never by its text (§104)', async () => {
    // The throw path trusts nothing about the error: its message is whatever the lowest layer wrote,
    // and a rejected-recipient error is exactly the kind that names the recipient.
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    app.clock.advanceByDays(3);
    await app.sweep.run(); // clock 3 timeout → REFUND_ORDERED
    await login(seller, SELLER);
    vi.spyOn(app.email, 'send').mockRejectedValue(new Error(`recipient ${BUYER} rejected`));
    const warned: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((entry: unknown) => {
      warned.push(String(entry));
    });

    expect((await uploadRefundSlip(seller, order.id)).status).toBe(201);

    expect(warned.join('\n')).toContain('REFUND_SLIP_UPLOADED');
    expect(warned.join('\n')).not.toContain(BUYER);
  });

  it('a burst of chat messages is one unread notification per room, not one per message; after reading, the next message raises a new one', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const socket = chatSocket(app, buyer);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error: Error) => reject(error));
      socket.connect();
    });
    const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    for (let i = 1; i <= 5; i += 1) {
      await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: `ข้อความที่ ${String(i)}` });
    }
    const chatRows = (await notificationsFor(seller, SELLER)).filter((n) => n.type === 'CHAT_MESSAGE' && n.targetId === roomId);
    expect(chatRows).toHaveLength(1);

    await seller.post(`${API}/notifications/read-all`).set(CSRF_HEADER, await csrfToken(seller));
    await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'หลังร้านอ่านแล้ว' });
    socket.disconnect();

    const afterRead = (await notificationsFor(seller, SELLER)).filter((n) => n.type === 'CHAT_MESSAGE' && n.targetId === roomId);
    expect(afterRead).toHaveLength(2);
    expect(await unreadCountFor(seller, SELLER)).toBe(1);
  });
});

describe('code review of topics 9–10 (§85)', () => {
  it('the shop is told when the buyer rejects its shipping fee — in-app only', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    app.email.clear();
    await buyer.post(`${API}/orders/${order.id}/reject-shipping-fee`).set(CSRF_HEADER, await csrfToken(buyer)).send({ reason: 'ค่าส่งแพงเกินไปมาก' });

    const notes = await notificationsFor(seller, SELLER);

    expect(notes).toContainEqual(expect.objectContaining({ type: 'ORDER_SHIPPING_FEE_REJECTED', targetId: order.id }));
    expect(app.email.sent).toHaveLength(0);
  });

  it('the shop is told when the buyer cancels an order — in-app only', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    app.email.clear();
    await buyer.post(`${API}/orders/${order.id}/cancel`).set(CSRF_HEADER, await csrfToken(buyer)).send({ reason: 'สั่งผิดรายการ' });

    const notes = await notificationsFor(seller, SELLER);

    expect(notes).toContainEqual(expect.objectContaining({ type: 'ORDER_CANCELLED_BY_BUYER', targetId: order.id }));
    expect(app.email.sent).toHaveLength(0);
  });
});
