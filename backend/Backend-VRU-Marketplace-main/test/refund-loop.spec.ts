import sharp from 'sharp';
import { vi } from 'vitest';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #65: the closed loop after `REFUND_ORDERED` — the buyer's own receiving account (L9), the
 * shop's proof of sending it back within 7 days or else a reputation hit (K11), the buyer's own
 * confirmation (H6) or a 7-day cron that assumes they got it if they go silent (H7), landing at
 * `REFUNDED` (I8) — a real status, distinct from `CANCELLED`.
 *
 * Also covers the #64 bug this ticket's own AC surfaced: a `BUYER_WINS` ruling must leave its
 * dispute *open* (not close it at ruling time) so a community admin's break-glass access keeps
 * working through the whole refund loop — H7 is what actually revokes it, per that ticket's own
 * "H7 คือสิ่งที่ตัดสิทธิ์เห็น PII ของแอดมิน (#64)".
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
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
  refundOrderedAt: string | null;
  refundAccountType: string | null;
  refundBankName: string | null;
  refundBankAccountNumber: string | null;
  refundBankAccountName: string | null;
  refundPromptPayId: string | null;
}
interface RefundSlipBody {
  id: string;
  orderId: string;
}
interface DisputeBody {
  id: string;
  orderId: string;
  closedAt: string | null;
  verdict: string | null;
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

async function placeOrder(app: TestApp, buyer: Agent, variantId: string): Promise<OrderBody> {
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity: 1 });
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

async function uploadRefundSlip(seller: Agent, orderId: string): Promise<RefundSlipBody> {
  const response = await seller
    .post(`${API}/shops/me/orders/${orderId}/refund-slips`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .attach('file', await aJpegBuffer(), 'refund-slip.jpg');

  return response.body as RefundSlipBody;
}

async function submitRefundAccount(buyer: Agent, orderId: string, body: Record<string, unknown>) {
  return buyer
    .post(`${API}/orders/${orderId}/refund-account`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send(body);
}

async function confirmRefundReceived(buyer: Agent, orderId: string) {
  return buyer.post(`${API}/orders/${orderId}/refund-received`).set(CSRF_HEADER, await csrfToken(buyer));
}

async function orderStatus(client: Agent, email: string, orderId: string): Promise<OrderBody> {
  await login(client, email);
  const response = await client.get(`${API}/orders/${orderId}`);

  return response.body as OrderBody;
}

async function suspend(client: Agent, shopId: string, reason = 'เหตุผลสำหรับทดสอบการระงับร้าน') {
  return client
    .post(`${API}/shops/${shopId}/suspend`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

const BANK_ACCOUNT = { type: 'BANK_TRANSFER', bankName: 'ธนาคารทดสอบ', bankAccountNumber: '1234567890', bankAccountName: 'สมชาย ใจดี' };
const PROMPTPAY_ACCOUNT = { type: 'PROMPTPAY', promptPayId: '0899999999' };

/**
 * A community, an approved shop and product, and a `REFUND_ORDERED` order reached the *real*
 * way — checkout, shipping fee, a slip, then clock 3's own 3-day timeout swept for real (I1) —
 * never a shortcut write to `status`. Buyer stays logged in as the order's own `Agent`.
 */
async function refundOrderedScenario(app: TestApp): Promise<{
  superAdmin: Agent;
  seller: Agent;
  sellerId: string;
  shopId: string;
  buyer: Agent;
  order: OrderBody;
}> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

  const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบคืนเงิน', 10000, 5);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, product.variants[0]!.id);
  await setShippingFee(seller, order.id, 2000);
  await uploadPaymentSlip(buyer, order.id);

  app.clock.advanceByDays(3);
  await app.sweep.run();

  const refunded = await orderStatus(buyer, BUYER, order.id);
  expect(refunded.status).toBe('REFUND_ORDERED');

  // The 3-day advance above expires every session's short-lived access token (15 simulated
  // minutes) — re-sign in every client this scenario hands back, the same way `orderStatus`
  // already does for `buyer` internally, or the next call any of them makes 401s for reasons
  // that have nothing to do with what the test is actually checking.
  await login(seller, SELLER);
  await login(superAdmin, SUPER);

  return { superAdmin, seller, sellerId, shopId, buyer, order };
}

describe('#65 (L9) — the buyer’s own refund-receiving account', () => {
  it('accepted only while REFUND_ORDERED, visible on the order afterward, and swappable between bank/PromptPay', async () => {
    const app = getApp();
    const { buyer, order } = await refundOrderedScenario(app);

    const bankResponse = await submitRefundAccount(buyer, order.id, BANK_ACCOUNT);
    expect(bankResponse.status).toBe(200);
    const bankBody = bankResponse.body as OrderBody;
    expect(bankBody.refundAccountType).toBe('BANK_TRANSFER');
    expect(bankBody.refundBankAccountNumber).toBe('1234567890');
    expect(bankBody.refundPromptPayId).toBeNull();

    const promptPayResponse = await submitRefundAccount(buyer, order.id, PROMPTPAY_ACCOUNT);
    expect(promptPayResponse.status).toBe(200);
    const promptPayBody = promptPayResponse.body as OrderBody;
    expect(promptPayBody.refundAccountType).toBe('PROMPTPAY');
    expect(promptPayBody.refundPromptPayId).toBe('0899999999');
    expect(promptPayBody.refundBankAccountNumber).toBeNull();
  });

  it('refused before REFUND_ORDERED', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id); // still AWAITING_SHIPPING_QUOTE

    const response = await submitRefundAccount(buyer, order.id, BANK_ACCOUNT);
    expect(response.status).toBe(409);
  });

  it('refused once the shop has already uploaded a refund slip', async () => {
    const app = getApp();
    const { seller, buyer, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);

    const response = await submitRefundAccount(buyer, order.id, BANK_ACCOUNT);
    expect(response.status).toBe(409);
  });

  it('wiped back to null the instant the order reaches REFUNDED (H6)', async () => {
    const app = getApp();
    const { seller, buyer, order } = await refundOrderedScenario(app);
    await submitRefundAccount(buyer, order.id, BANK_ACCOUNT);
    await uploadRefundSlip(seller, order.id);

    const response = await confirmRefundReceived(buyer, order.id);
    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.status).toBe('REFUNDED');
    expect(body.refundAccountType).toBeNull();
    expect(body.refundBankAccountNumber).toBeNull();
  });
});

describe('#65 (K11) — the shop’s 7-day refund-slip window', () => {
  it('a slip uploads only while REFUND_ORDERED, and is listable/readable by both parties afterward', async () => {
    const app = getApp();
    const { seller, buyer, order } = await refundOrderedScenario(app);

    const slip = await uploadRefundSlip(seller, order.id);
    expect(typeof slip.id).toBe('string');

    const buyerList = await buyer.get(`${API}/orders/${order.id}/refund-slips`);
    expect(buyerList.status).toBe(200);
    expect((buyerList.body as RefundSlipBody[])).toHaveLength(1);

    const file = await login(seller, SELLER).then(() => seller.get(`${API}/orders/${order.id}/refund-slips/${slip.id}/file`));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('image/jpeg');
  });

  it('a suspended shop can still upload a refund slip (J2) — this is exactly the pressure that forces a refund', async () => {
    const app = getApp();
    const { superAdmin, shopId, seller, order } = await refundOrderedScenario(app);
    const suspendResponse = await suspend(superAdmin, shopId);
    expect(suspendResponse.status).toBe(200);

    const response = await uploadRefundSlip(seller, order.id);
    expect(typeof response.id).toBe('string');
  });

  it('🚨 7 days with no slip flags the shop owner’s disputeLostCount — the order itself is never closed', async () => {
    const app = getApp();
    const { sellerId, order } = await refundOrderedScenario(app);

    app.clock.advanceByDays(7);
    const report = await app.sweep.run();
    expect(report.outcomes).toContainEqual({ name: 'orders.flagRefundSlipOverdue', handled: 1, failed: false });

    const sellerRow = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(sellerRow.disputeLostCount).toBe(1);

    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderRow.status).toBe('REFUND_ORDERED'); // never closed for this
  });

  it('does not flag before 7 real days have passed', async () => {
    const app = getApp();
    const { sellerId } = await refundOrderedScenario(app);

    app.clock.advanceByDays(6);
    await app.sweep.run();

    const sellerRow = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(sellerRow.disputeLostCount).toBe(0);
  });

  it('does not flag twice across repeated sweeps', async () => {
    const app = getApp();
    const { sellerId } = await refundOrderedScenario(app);

    app.clock.advanceByDays(7);
    await app.sweep.run();
    await app.sweep.run();

    const sellerRow = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(sellerRow.disputeLostCount).toBe(1);
  });

  it('no flag once a slip exists before the sweep catches it, even if it was uploaded late', async () => {
    const app = getApp();
    const { seller, sellerId, order } = await refundOrderedScenario(app);

    app.clock.advanceByDays(6);
    await login(seller, SELLER);
    await uploadRefundSlip(seller, order.id); // 6 days in — technically cutting it close, still on time
    app.clock.advanceByDays(1);
    await app.sweep.run();

    const sellerRow = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(sellerRow.disputeLostCount).toBe(0);
  });
});

describe('#65 (H6/H7/I8) — confirming receipt, or the cron assuming it', () => {
  it('H6: the buyer confirming moves the order to REFUNDED — a real status, not CANCELLED', async () => {
    const app = getApp();
    const { seller, buyer, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);

    const response = await confirmRefundReceived(buyer, order.id);
    expect(response.status).toBe(200);
    expect((response.body as OrderBody).status).toBe('REFUNDED');
  });

  it('H6: refused before any refund slip exists', async () => {
    const app = getApp();
    const { buyer, order } = await refundOrderedScenario(app);

    const response = await confirmRefundReceived(buyer, order.id);
    expect(response.status).toBe(409);
  });

  it('H6: not reachable by the shop, even on its own order — this route only ever means "I, the buyer"', async () => {
    const app = getApp();
    const { seller, order } = await refundOrderedScenario(app);
    await login(seller, SELLER);

    const response = await confirmRefundReceived(seller, order.id);
    expect(response.status).toBe(404); // no order where buyerId = the seller's own user id
  });

  it('H7: silence for 7 real days after the shop’s first slip auto-closes to REFUNDED', async () => {
    const app = getApp();
    const { seller, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);

    app.clock.advanceByDays(7);
    const report = await app.sweep.run();
    expect(report.outcomes).toContainEqual({ name: 'orders.expireRefundBuyerConfirm', handled: 1, failed: false });

    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderRow.status).toBe('REFUNDED');
  });

  it('H7: does not close before 6 real days have passed', async () => {
    const app = getApp();
    const { seller, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);

    app.clock.advanceByDays(6);
    await app.sweep.run();

    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderRow.status).toBe('REFUND_ORDERED');
  });

  it('I8: REFUNDED and CANCELLED read as two different histories', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    // Community and category names are unique (§112 for communities) — distinct names from
    // refundOrderedScenario's own "ชุมชนบางแสน"/"เสื้อผ้า", since this test calls both in the same process.
    const communityId = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'ของใช้ทั่วไป');
    // A distinct seller/buyer pair from refundOrderedScenario's own SELLER/BUYER constants — 1
    // person = 1 shop globally, so reusing SELLER here would fail the second shop application.
    const { seller } = await sellerWithShop(app, 'other-seller@example.test', communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, 'other-buyer@example.test');
    const cancelledOrder = await placeOrder(app, buyer, product.variants[0]!.id);
    await buyer.post(`${API}/orders/${cancelledOrder.id}/cancel`).set(CSRF_HEADER, await csrfToken(buyer)).send({});

    const { order: refundedOrder, seller: refundSeller, buyer: refundBuyer } = await refundOrderedScenario(app);
    await uploadRefundSlip(refundSeller, refundedOrder.id);
    await confirmRefundReceived(refundBuyer, refundedOrder.id);

    const cancelledRow = await app.prisma.order.findUniqueOrThrow({ where: { id: cancelledOrder.id } });
    const refundedRow = await app.prisma.order.findUniqueOrThrow({ where: { id: refundedOrder.id } });
    expect(cancelledRow.status).toBe('CANCELLED');
    expect(refundedRow.status).toBe('REFUNDED');
    expect(refundedRow.status).not.toBe(cancelledRow.status);
  });
});

describe('#65 × #64 — a BUYER_WINS dispute stays open through the whole refund loop', () => {
  async function assignAdminAndOpenBuyerWinsDispute(app: TestApp): Promise<{
    adminA: Agent;
    seller: Agent;
    buyer: Agent;
    order: OrderBody;
    dispute: DisputeBody;
  }> {
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const adminA = newClient(app);
    const adminAId = await registerVerified(app, adminA, 'admin-a@example.test');
    await assignAdmin(superAdmin, communityId, adminAId);

    const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบข้อพิพาทคืนเงิน', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);

    const opened = await buyer
      .post(`${API}/orders/${order.id}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'สินค้าที่ได้รับไม่ตรงกับที่สั่งเลยครับ')
      .attach('files', await aJpegBuffer(), 'evidence.jpg');
    const dispute = opened.body as DisputeBody;

    const ruled = await adminA
      .post(`${API}/disputes/${dispute.id}/ruling`)
      .set(CSRF_HEADER, await csrfToken(adminA))
      .send({ verdict: 'BUYER_WINS', reason: 'สินค้าที่ส่งไม่ตรงตามที่ตกลงไว้จริง ผู้ซื้อจึงเป็นฝ่ายถูก' });
    expect(ruled.status).toBe(200);
    expect((ruled.body as DisputeBody).closedAt).toBeNull();

    void shopId;
    void sellerId;
    return { adminA, seller, buyer, order, dispute };
  }

  it('break-glass still works right after a BUYER_WINS ruling — the dispute is open, not closed', async () => {
    const app = getApp();
    const { adminA, dispute } = await assignAdminAndOpenBuyerWinsDispute(app);

    const response = await adminA
      .post(`${API}/disputes/${dispute.id}/break-glass`)
      .set(CSRF_HEADER, await csrfToken(adminA))
      .send({ reason: 'ตรวจสอบสถานะคืนเงินระหว่างที่รอร้านคืนเงิน' });
    expect(response.status).toBe(200);
  });

  it('H6 (buyer confirms) closes the dispute that started the refund loop', async () => {
    const app = getApp();
    const { adminA, seller, buyer, order, dispute } = await assignAdminAndOpenBuyerWinsDispute(app);
    await uploadRefundSlip(seller, order.id);

    const confirmed = await confirmRefundReceived(buyer, order.id);
    expect(confirmed.status).toBe(200);

    const disputeRow = await app.prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(disputeRow.closedAt).not.toBeNull();

    const afterClosed = await adminA
      .post(`${API}/disputes/${dispute.id}/break-glass`)
      .set(CSRF_HEADER, await csrfToken(adminA))
      .send({ reason: 'ลองดูอีกครั้งหลังปิดเรื่องแล้ว' });
    expect(afterClosed.status).toBe(404);
  });

  it('🚨 H7 (buyer silent, cron closes it) is what finally revokes the admin’s break-glass access', async () => {
    const app = getApp();
    const { adminA, seller, order, dispute } = await assignAdminAndOpenBuyerWinsDispute(app);
    await uploadRefundSlip(seller, order.id);

    app.clock.advanceByDays(7);
    await app.sweep.run();

    const disputeRow = await app.prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(disputeRow.closedAt).not.toBeNull();

    await login(adminA, 'admin-a@example.test');
    const response = await adminA
      .post(`${API}/disputes/${dispute.id}/break-glass`)
      .set(CSRF_HEADER, await csrfToken(adminA))
      .send({ reason: 'ลองดูหลัง cron ปิดให้แล้ว' });
    expect(response.status).toBe(404);
  });
});

describe('code review of topic 10 — the refund loop (§85)', () => {
  const RULING = 'ตรวจหลักฐานทั้งสองฝ่ายแล้ว ตัดสินตามข้อเท็จจริงที่ปรากฏ';

  async function unsuspend(client: Agent, shopId: string) {
    return client.post(`${API}/shops/${shopId}/unsuspend`).set(CSRF_HEADER, await csrfToken(client));
  }
  async function openDispute(buyer: Agent, orderId: string, reason = 'ร้านบอกว่าคืนเงินแล้วแต่เงินยังไม่เข้าบัญชีเลย') {
    return buyer
      .post(`${API}/orders/${orderId}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', reason)
      .attach('files', await aJpegBuffer(), 'evidence.jpg');
  }
  async function rule(admin: Agent, disputeId: string, verdict: string) {
    return admin.post(`${API}/disputes/${disputeId}/ruling`).set(CSRF_HEADER, await csrfToken(admin)).send({ verdict, reason: RULING });
  }
  async function override(admin: Agent, disputeId: string, verdict: string) {
    return admin.post(`${API}/disputes/${disputeId}/override`).set(CSRF_HEADER, await csrfToken(admin)).send({ verdict, reason: RULING });
  }
  async function lostCount(app: TestApp, sellerId: string): Promise<number> {
    return (await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } })).disputeLostCount;
  }
  async function signInAll(...pairs: [Agent, string][]): Promise<void> {
    for (const [client, email] of pairs) {
      await login(client, email);
    }
  }

  /** PAYMENT_SUBMITTED frozen 20 days by a suspension, then unsuspended and left to clock 3 → REFUND_ORDERED. */
  async function refundOrderedAfterLongFreeze(app: TestApp) {
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    await suspend(superAdmin, shopId);
    app.clock.advanceByDays(20);
    await login(superAdmin, SUPER);
    await unsuspend(superAdmin, shopId);
    app.clock.advanceByDays(3);
    app.clock.advanceByHours(1);
    await app.sweep.run();
    expect((await orderStatus(buyer, BUYER, order.id)).status).toBe('REFUND_ORDERED');
    await signInAll([seller, SELLER], [superAdmin, SUPER]);

    return { superAdmin, seller, sellerId, shopId, buyer, order };
  }

  it('K11 counts 7 days from REFUND_ORDERED — a freeze that ended before the refund was even ordered buys the shop nothing', async () => {
    const app = getApp();
    const { sellerId } = await refundOrderedAfterLongFreeze(app);

    app.clock.advanceByDays(7);
    app.clock.advanceByHours(1);
    await app.sweep.run();

    expect(await lostCount(app, sellerId)).toBe(1);
  });

  it('H7 counts 7 days from the refund slip — an old freeze does not stretch it', async () => {
    const app = getApp();
    const { seller, buyer, order } = await refundOrderedAfterLongFreeze(app);
    await uploadRefundSlip(seller, order.id);

    app.clock.advanceByDays(7);
    app.clock.advanceByHours(1);
    await app.sweep.run();

    expect((await orderStatus(buyer, BUYER, order.id)).status).toBe('REFUNDED');
  });

  it('H7 frozen mid-window restarts at a full 7 days on release (H3), not whatever was left', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, buyer, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);
    app.clock.advanceByDays(3);
    await login(superAdmin, SUPER);
    await suspend(superAdmin, shopId);
    app.clock.advanceByDays(10);
    await login(superAdmin, SUPER);
    await unsuspend(superAdmin, shopId);

    app.clock.advanceByDays(5);
    await app.sweep.run();
    expect((await orderStatus(buyer, BUYER, order.id)).status).toBe('REFUND_ORDERED');

    app.clock.advanceByDays(3);
    await app.sweep.run();
    expect((await orderStatus(buyer, BUYER, order.id)).status).toBe('REFUNDED');
  });

  it('H7 waits for a ruling while the buyer’s "money never arrived" dispute is open — it no longer closes it silently', async () => {
    const app = getApp();
    const { superAdmin, seller, buyer, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);
    app.clock.advanceByDays(1);
    await login(buyer, BUYER);
    const dispute = (await openDispute(buyer, order.id)).body as DisputeBody;

    app.clock.advanceByDays(7);
    await app.sweep.run();
    expect((await orderStatus(buyer, BUYER, order.id)).status).toBe('REFUND_ORDERED');
    const stillOpen = (await buyer.get(`${API}/orders/${order.id}/dispute`)).body as DisputeBody[];
    expect(stillOpen[0]).toMatchObject({ id: dispute.id, closedAt: null, verdict: null });

    await login(superAdmin, SUPER);
    expect((await rule(superAdmin, dispute.id, 'SHOP_WINS')).status).toBe(200);
    await app.sweep.run();
    expect((await orderStatus(buyer, BUYER, order.id)).status).toBe('REFUNDED');
  });

  it('BUYER_WINS on an order already mid-refund restarts the loop — the old slip no longer counts, the shop must send a new one', async () => {
    const app = getApp();
    const { superAdmin, seller, sellerId, buyer, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);
    const dispute = (await openDispute(buyer, order.id)).body as DisputeBody;
    expect((await rule(superAdmin, dispute.id, 'BUYER_WINS')).status).toBe(200);

    expect((await confirmRefundReceived(buyer, order.id)).status).toBe(409);
    expect((await submitRefundAccount(buyer, order.id, PROMPTPAY_ACCOUNT)).status).toBe(200);

    app.clock.advanceByDays(7);
    app.clock.advanceByHours(1);
    await app.sweep.run();
    expect((await orderStatus(buyer, BUYER, order.id)).status).toBe('REFUND_ORDERED');
    expect(await lostCount(app, sellerId)).toBe(2); // the ruling, then K11 on the restarted window

    await login(seller, SELLER);
    await uploadRefundSlip(seller, order.id);
    expect((await confirmRefundReceived(buyer, order.id)).status).toBe(200);
  });

  it('a REFUNDED order cannot have a new dispute opened on it', async () => {
    const app = getApp();
    const { seller, buyer, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);
    await confirmRefundReceived(buyer, order.id);

    const response = await openDispute(buyer, order.id, 'เงินคืนไม่ครบตามยอดที่โอนไปครับ');

    expect(response.status).toBe(409);
  });

  it('overriding BUYER_WINS to SHOP_WINS mid-loop: the loop keeps running, but K11 no longer penalizes the shop for it', async () => {
    const app = getApp();
    const { superAdmin, sellerId, buyer, order } = await refundOrderedScenario(app);
    const dispute = (await openDispute(buyer, order.id, 'ร้านไม่ส่งของและไม่ยอมคืนเงินเลย')).body as DisputeBody;
    await rule(superAdmin, dispute.id, 'BUYER_WINS');
    expect((await override(superAdmin, dispute.id, 'SHOP_WINS')).status).toBe(200);
    expect(await lostCount(app, sellerId)).toBe(0);

    app.clock.advanceByDays(8);
    await app.sweep.run();

    expect(await lostCount(app, sellerId)).toBe(0);
    expect((await orderStatus(buyer, BUYER, order.id)).status).toBe('REFUND_ORDERED');
  });

  it('a refund slip is served private, no-store and nosniff (§83)', async () => {
    const app = getApp();
    const { seller, buyer, order } = await refundOrderedScenario(app);
    const slip = await uploadRefundSlip(seller, order.id);

    const response = await buyer.get(`${API}/orders/${order.id}/refund-slips/${slip.id}/file`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('K11 does not penalize a shop whose refund slip lands while the sweep is already running', async () => {
    const app = getApp();
    const { seller, sellerId, order } = await refundOrderedScenario(app);
    app.clock.advanceByDays(7);
    app.clock.advanceByHours(1);
    await login(seller, SELLER);
    const original = app.prisma.order.findMany.bind(app.prisma.order);
    let injected = false;
    vi.spyOn(app.prisma.order, 'findMany').mockImplementation((async (args: { where?: Record<string, unknown> }) => {
      const rows = await original(args as never);
      if (!injected && args.where !== undefined && 'refundOverdueFlaggedAt' in args.where) {
        injected = true;
        await uploadRefundSlip(seller, order.id);
      }
      return rows;
    }) as never);

    await app.sweep.run();

    expect(injected).toBe(true);
    expect(await lostCount(app, sellerId)).toBe(0);
  });

  it('a refund slip upload that lands just after the buyer confirmed is refused — the loop already closed', async () => {
    const app = getApp();
    const { seller, buyer, order } = await refundOrderedScenario(app);
    await uploadRefundSlip(seller, order.id);
    const original = app.prisma.order.findFirst.bind(app.prisma.order);
    let confirmed = 0;
    vi.spyOn(app.prisma.order, 'findFirst').mockImplementationOnce((async (args: unknown) => {
      const read = await original(args as never);
      confirmed = (await confirmRefundReceived(buyer, order.id)).status;
      return read;
    }) as never);

    const response = await seller
      .post(`${API}/shops/me/orders/${order.id}/refund-slips`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', await aJpegBuffer(), 'late.jpg');

    expect(confirmed).toBe(200);
    expect(response.status).toBe(409);
  });
});
