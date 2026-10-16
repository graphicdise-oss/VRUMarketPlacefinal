import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { OrderDeadlineWarningPort } from '../src/order/ports/order-deadline-warning.port.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #57 (I3b/I1): makes clock 3 real. `order-sweep.spec.ts` (#53) already proved the sweep
 * mechanics themselves (expiry, no-early-expiry, once-only warning) by writing
 * `paymentConfirmationWindowStartedAt` directly via Prisma, with its own comment saying real
 * `PaymentSlip` data was topic 8's job. This file is that job: every test here drives
 * `paymentConfirmationWindowStartedAt` through real slip uploads and rejections over HTTP, then
 * asserts through the same `sweep.run()` seam — never a second sweep, never a fabricated field.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';

interface OrderBody {
  id: string;
  status: string;
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

async function sellerWithShop(app: TestApp, email: string, communityId: string): Promise<Agent> {
  const seller = newClient(app);
  await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return seller;
}

async function approvedProduct(superAdmin: Agent, seller: Agent, categoryId: string, stock = 5): Promise<{ productId: string; variantId: string }> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name: 'ของทดสอบเรือน 3',
      description: 'คำอธิบายสินค้าสำหรับทดสอบ',
      categoryId,
      variants: [{ name: 'แบบเดียว', priceAmountMinor: 10000, stock }],
    });
  const productId = (created.body as { id: string }).id;
  await approveProduct(superAdmin, productId);

  const fetched = await seller.get(`${API}/products/${productId}`);
  const body = fetched.body as { variants: { id: string }[] };

  return { productId, variantId: body.variants[0]!.id };
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

async function placeOrder(app: TestApp, buyer: Agent, buyerEmail: string, variantId: string): Promise<OrderBody> {
  await login(buyer, buyerEmail);
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity: 1 });
  const response = await checkoutAsShown(buyer, addressId);

  return (response.body as OrderBody[])[0]!;
}

async function setShippingFee(seller: Agent, sellerEmail: string, orderId: string, shippingAmountMinor: number) {
  await login(seller, sellerEmail);

  return seller
    .post(`${API}/shops/me/orders/${orderId}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingAmountMinor });
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

/** Every session touching a slip after a clock jump needs a fresh 15-minute cookie — see `order-sweep.spec.ts`'s identical concern. */
async function uploadSlip(buyer: Agent, buyerEmail: string, orderId: string) {
  await login(buyer, buyerEmail);
  const response = await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');

  return response.body as { id: string };
}

async function rejectSlip(seller: Agent, sellerEmail: string, orderId: string, slipId: string) {
  await login(seller, sellerEmail);

  return seller
    .post(`${API}/shops/me/orders/${orderId}/payment-slips/${slipId}/reject`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ reason: 'ยอดโอนไม่ตรงกับยอดที่ต้องชำระ กรุณาตรวจสอบและโอนใหม่' });
}

async function orderStatus(client: Agent, email: string, orderId: string): Promise<OrderBody> {
  await login(client, email);
  const response = await client.get(`${API}/orders/${orderId}`);

  return response.body as OrderBody;
}

/** Places an order, quotes shipping, and uploads the first real slip — PAYMENT_SUBMITTED, clock 3 running for real. */
async function orderPaymentSubmitted(app: TestApp, stock = 5): Promise<{ seller: Agent; buyer: Agent; order: OrderBody; variantId: string; slipId: string }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const seller = await sellerWithShop(app, SELLER, communityId);
  const { variantId } = await approvedProduct(superAdmin, seller, categoryId, stock);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, BUYER, variantId);
  await setShippingFee(seller, SELLER, order.id, 2000);
  const slip = await uploadSlip(buyer, BUYER, order.id);

  return { seller, buyer, order, variantId, slipId: slip.id };
}

describe('clock 3 driven by real slips (#57, I3b): counts from the current round’s first slip', () => {
  it('a real slip upload starts the clock, and 3 real days later the sweep moves it to REFUND_ORDERED', async () => {
    const app = getApp();
    const { buyer, order } = await orderPaymentSubmitted(app);

    app.clock.advanceByDays(3);
    const report = await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('REFUND_ORDERED');
    expect(report.outcomes).toContainEqual({ name: 'orders.expirePaymentConfirmation', handled: 1, failed: false });
  });

  it('does not expire before 3 real days have passed', async () => {
    const app = getApp();
    const { buyer, order } = await orderPaymentSubmitted(app);

    app.clock.advanceByDays(2);
    await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('PAYMENT_SUBMITTED');
  });

  it('a second real upload in the same round does not reset the clock (I3)', async () => {
    const app = getApp();
    const { buyer, order } = await orderPaymentSubmitted(app);

    app.clock.advanceByDays(1);
    await uploadSlip(buyer, BUYER, order.id); // still PAYMENT_SUBMITTED — no shop action in between

    app.clock.advanceByDays(2); // 3 days total since the FIRST slip, only 2 since the second
    await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('REFUND_ORDERED');
  });

  it('🚨 the I3b test in full: reject → re-upload → the clock counts from the new slip, not the first one', async () => {
    const app = getApp();
    const { seller, buyer, order, slipId } = await orderPaymentSubmitted(app);

    app.clock.advanceByDays(1);
    const rejected = await rejectSlip(seller, SELLER, order.id, slipId);
    expect(rejected.status).toBe(200);
    await uploadSlip(buyer, BUYER, order.id); // new round — clock 3 restarts here

    // 2.9 days since the SECOND slip (3.9 since the first). If the clock were still anchored to
    // the first slip, this would already be expired; if correctly anchored to the round that
    // matters, it must not be.
    app.clock.advanceByDays(2);
    app.clock.advanceByHours(21.6);
    await app.sweep.run();
    const stillOpen = await orderStatus(buyer, BUYER, order.id);
    expect(stillOpen.status).toBe('PAYMENT_SUBMITTED');

    // Now cross 3 days since the second slip.
    app.clock.advanceByHours(3);
    await app.sweep.run();
    const expired = await orderStatus(buyer, BUYER, order.id);
    expect(expired.status).toBe('REFUND_ORDERED');
  });

  it('after 2 rejections use up the cap, the final un-rejected round can still expire into REFUND_ORDERED, and the reservation releases cleanly', async () => {
    const app = getApp();
    const { seller, buyer, order, variantId, slipId } = await orderPaymentSubmitted(app, 1); // stock 1 — the last unit

    const firstReject = await rejectSlip(seller, SELLER, order.id, slipId);
    expect(firstReject.status).toBe(200);
    const slip2 = await uploadSlip(buyer, BUYER, order.id);
    const secondReject = await rejectSlip(seller, SELLER, order.id, slip2.id);
    expect(secondReject.status).toBe(200); // cap reached (2/2) — no more rejections possible
    await uploadSlip(buyer, BUYER, order.id); // final round, nothing left but confirm or let it expire

    app.clock.advanceByDays(3);
    await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('REFUND_ORDERED');

    // Stock was never cut (only PAID cuts it, #55) and REFUND_ORDERED falls outside the reserving
    // statuses (#50) — a fresh buyer can check out the same unit right away.
    const variantRow = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variantRow.stock).toBe(1);
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, 'other-buyer@example.test');
    const addressId = await createAddress(app, otherBuyer);
    await otherBuyer
      .post(`${API}/cart/items`)
      .set(CSRF_HEADER, await csrfToken(otherBuyer))
      .send({ variantId, quantity: 1 });
    const response = await checkoutAsShown(otherBuyer, addressId);
    expect(response.status).toBe(201);
  });

  it('warns once with 24 hours left, driven by a real slip', async () => {
    const app = getApp();
    const { order } = await orderPaymentSubmitted(app);
    const warn = vi.spyOn(app.app.get(OrderDeadlineWarningPort), 'warn');

    app.clock.advanceByDays(2); // 48h in — exactly 24h left on a 3-day clock
    await app.sweep.run();
    expect(warn).toHaveBeenCalledExactlyOnceWith(order.id, 'PAYMENT_CONFIRMATION');

    await app.sweep.run();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('once a real slip exists, neither side can cancel unilaterally anymore (H5) — the test #52 owed', () => {
  it('refuses the buyer’s cancel once a real slip has been submitted', async () => {
    const app = getApp();
    const { buyer, order } = await orderPaymentSubmitted(app);
    await login(buyer, BUYER);

    const response = await buyer
      .post(`${API}/orders/${order.id}/cancel`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .send({});

    expect(response.status).toBe(409);
  });

  it('refuses the shop’s cancel once a real slip has been submitted', async () => {
    const app = getApp();
    const { seller, order } = await orderPaymentSubmitted(app);
    await login(seller, SELLER);

    const response = await seller
      .post(`${API}/shops/me/orders/${order.id}/cancel`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ reason: 'อยากลองยกเลิกดูหลังจากมีสลิปจริงแล้ว' });

    expect(response.status).toBe(409);
  });
});
