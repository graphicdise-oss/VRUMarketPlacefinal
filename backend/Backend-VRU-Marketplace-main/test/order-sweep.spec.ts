import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { OrderDeadlineWarningPort } from '../src/order/ports/order-deadline-warning.port.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #53 — "หัวใจของทั้งโปรเจค": the three clocks invariant 3 describes, driven by the one sweep
 * point #17 built and #51/#52 already lean on. Follows M5's own pattern throughout: arrange over
 * HTTP → move `clock` → call `sweep.run()` directly → assert over HTTP (or via `app.prisma` where
 * nothing reads it back yet).
 *
 * Code review of topic 7 (§81): clock 3 used to be arranged by writing `status` and
 * `paymentConfirmationWindowStartedAt` straight through Prisma, and "frozen" by writing `frozenAt`
 * — reasonable when topics 8 and 10 didn't exist yet, but both have real HTTP paths now (a real
 * slip upload, a real shop suspension), so every arrangement here goes through them instead.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  shopId: string;
  status: string;
  expiresAt: string | null;
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
    .send({
      recipientName: 'สมชาย ใจดี',
      phone: '0812345678',
      houseNumber: '99/9',
      subdistrictPostalCodeId,
    });

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

/** Same re-login concern as `orderStatus` — the seller's cookie from checkout is a 15-minute one too. */
async function setShippingFee(seller: Agent, orderId: string, shippingAmountMinor: number) {
  await login(seller, SELLER);

  return seller
    .post(`${API}/shops/me/orders/${orderId}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingAmountMinor });
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

/** The real topic-8 transition into PAYMENT_SUBMITTED — also what starts clock 3 (#57). Re-logs in for the same reason `setShippingFee` does. */
async function uploadSlip(buyer: Agent, orderId: string): Promise<void> {
  await login(buyer, BUYER);
  const response = await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
  expect(response.status).toBe(201);
}

/** The real topic-10 way an order gets frozen (invariant 7): a super admin suspends its shop. */
async function suspendShop(superAdmin: Agent, shopId: string): Promise<void> {
  await login(superAdmin, SUPER);
  const response = await superAdmin
    .post(`${API}/shops/${shopId}/suspend`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });
  expect(response.status).toBe(200);
}

/**
 * Reads the order back as the buyer, after however much clock time the test has advanced.
 *
 * `ACCESS_TOKEN_TTL_MINUTES` is 15 — every test here moves the clock by hours or days, so the
 * cookie from checkout is long expired by the time an assertion runs. Re-logging in (the same
 * account, a fresh session) before reading is what a real client would do on its own next
 * request; skipping it would make every assertion after a clock jump fail on 401, not on
 * whatever the test actually means to check.
 */
async function orderStatus(buyer: Agent, email: string, orderId: string): Promise<OrderBody> {
  await login(buyer, email);
  const response = await buyer.get(`${API}/orders/${orderId}`);
  return response.body as OrderBody;
}

/** Common arrangement for every clock-1 test: one order, freshly placed, still unquoted. */
async function freshOrder(app: TestApp): Promise<{ seller: Agent; buyer: Agent; order: OrderBody; variantId: string }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const seller = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ sweep', 10000, 5);
  const variantId = product.variants[0]!.id;
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, variantId, 1);

  return { seller, buyer, order, variantId };
}

describe('clock 1 — the shop has 24h from checkout to quote shipping', () => {
  it('does not cancel at 23 hours — proves it does not fire early', async () => {
    const app = getApp();
    const { buyer, order } = await freshOrder(app);

    app.clock.advanceByHours(23);
    await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('AWAITING_SHIPPING_QUOTE');
  });

  it('cancels and frees the reservation at 24 hours', async () => {
    const app = getApp();
    const { buyer, order, variantId } = await freshOrder(app);

    app.clock.advanceByHours(24);
    const report = await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('CANCELLED');
    expect(report.outcomes).toContainEqual({ name: 'orders.expireShippingQuote', handled: 1, failed: false });

    // A second buyer can now take the freed unit.
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, 'other-buyer@example.test');
    const secondOrder = await placeOrder(app, otherBuyer, variantId, 1);
    expect(secondOrder.status).toBe('AWAITING_SHIPPING_QUOTE');
  });

  it('sweeping twice in a row is idempotent — the second pass handles nothing', async () => {
    const app = getApp();
    const { order } = await freshOrder(app);

    app.clock.advanceByHours(24);
    const first = await app.sweep.run();
    const second = await app.sweep.run();

    expect(first.outcomes).toContainEqual({ name: 'orders.expireShippingQuote', handled: 1, failed: false });
    expect(second.outcomes).toContainEqual({ name: 'orders.expireShippingQuote', handled: 0, failed: false });
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('CANCELLED');
  });

  it('warns once at 18 hours (6 left) and never again', async () => {
    const app = getApp();
    const { order } = await freshOrder(app);
    const warn = vi.spyOn(app.app.get(OrderDeadlineWarningPort), 'warn');

    app.clock.advanceByHours(17);
    await app.sweep.run();
    expect(warn).not.toHaveBeenCalled();

    app.clock.advanceByHours(1); // total 18h
    await app.sweep.run();
    expect(warn).toHaveBeenCalledExactlyOnceWith(order.id, 'SHIPPING_QUOTE');

    await app.sweep.run(); // five minutes later, still within the window
    expect(warn).toHaveBeenCalledOnce();

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.shippingQuoteWarningSentAt).not.toBeNull();
  });
});

describe('clock 2 — the buyer has 24h from the shop’s shipping quote, not from checkout', () => {
  it('does not cancel at 23 hours after the quote', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 3000);

    app.clock.advanceByHours(23);
    await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('AWAITING_PAYMENT');
  });

  it('cancels 24h after the quote, not 24h after checkout — proves three independent clocks, not one timer', async () => {
    const app = getApp();
    const { seller, buyer, order, variantId } = await freshOrder(app);

    // The shop takes its time quoting — 20 hours after checkout, well inside clock 1's own window.
    app.clock.advanceByHours(20);
    await setShippingFee(seller, order.id, 3000);

    // Advance 23 more hours (43h total since checkout, but only 23h since the quote) — clock 2
    // must NOT have expired yet, because it counts from the quote, not from checkout.
    app.clock.advanceByHours(23);
    await app.sweep.run();
    const stillWaiting = await orderStatus(buyer, BUYER, order.id);
    expect(stillWaiting.status).toBe('AWAITING_PAYMENT');

    // One more hour — now a full 24h since the quote — and it cancels.
    app.clock.advanceByHours(1);
    await app.sweep.run();
    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('CANCELLED');

    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, 'other-buyer@example.test');
    const secondOrder = await placeOrder(app, otherBuyer, variantId, 1);
    expect(secondOrder.status).toBe('AWAITING_SHIPPING_QUOTE');
  });

  it('warns once at 18 hours after the quote and never again', async () => {
    const app = getApp();
    const { seller, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 3000);
    const warn = vi.spyOn(app.app.get(OrderDeadlineWarningPort), 'warn');

    app.clock.advanceByHours(18);
    await app.sweep.run();
    expect(warn).toHaveBeenCalledExactlyOnceWith(order.id, 'PAYMENT');

    await app.sweep.run();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('clock 3 — expiring is REFUND_ORDERED, not a cancellation (I1/H5)', () => {
  it('turns into REFUND_ORDERED after 3 days, and stock stays whatever it already was', async () => {
    const app = getApp();
    const { seller, buyer, order, variantId } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);

    app.clock.advanceByDays(3);
    const report = await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('REFUND_ORDERED');
    expect(report.outcomes).toContainEqual({ name: 'orders.expirePaymentConfirmation', handled: 1, failed: false });

    // Stock was never cut for PAYMENT_SUBMITTED (only PAID cuts it, #55) — variant.stock untouched.
    const variant = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.stock).toBe(5);
  });

  it('does not turn into REFUND_ORDERED before 3 days have passed', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);

    app.clock.advanceByDays(2);
    app.clock.advanceByHours(23);
    await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('PAYMENT_SUBMITTED');
  });

  it('warns once with 24 hours left (I17’s longer lead time for this clock)', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);
    const warn = vi.spyOn(app.app.get(OrderDeadlineWarningPort), 'warn');

    app.clock.advanceByDays(2); // 48h in — exactly 24h left on a 3-day clock
    await app.sweep.run();
    expect(warn).toHaveBeenCalledExactlyOnceWith(order.id, 'PAYMENT_CONFIRMATION');

    await app.sweep.run();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('a frozen order stops every clock (H3)', () => {
  it('does not expire clock 2 no matter how much time passes while frozen', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    await suspendShop(app.client, order.shopId);

    app.clock.advanceByDays(30);
    await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('AWAITING_PAYMENT');
    expect(after.expiresAt).toBeNull();
  });

  it('does not warn while frozen either', async () => {
    const app = getApp();
    const { seller, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    await suspendShop(app.client, order.shopId);
    const warn = vi.spyOn(app.app.get(OrderDeadlineWarningPort), 'warn');

    app.clock.advanceByDays(30);
    await app.sweep.run();

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not cancel an order that gets frozen between the sweep finding it and writing to it (§81)', async () => {
    const app = getApp();
    const { seller, buyer, order } = await freshOrder(app);
    await setShippingFee(seller, order.id, 2000);
    app.clock.advanceByHours(24);
    const superAdmin = app.client;
    await login(superAdmin, SUPER);

    // The one thing a seam-2 test can't arrange on its own: another request landing *inside* a
    // sweep pass. The spy lets clock 2's candidate query run for real, then — before the sweep
    // gets to write — freezes the order through the real HTTP path (a super admin suspending the
    // shop, invariant 7), exactly as a concurrent admin action would. `findMany`'s generic
    // signature can't be restated here, hence the `never` casts on the pass-through.
    const orders = app.prisma.order;
    const realFindMany = orders.findMany.bind(orders);
    let frozeMidSweep = false;
    vi.spyOn(orders, 'findMany').mockImplementation((async (args: { where?: Record<string, unknown> }) => {
      const rows = await realFindMany(args as never);
      const where = args.where ?? {};
      const isClock2Expiry = where.status === 'AWAITING_PAYMENT' && where.paymentWarningSentAt === undefined;
      if (isClock2Expiry && !frozeMidSweep) {
        frozeMidSweep = true;
        const suspended = await superAdmin
          .post(`${API}/shops/${order.shopId}/suspend`)
          .set(CSRF_HEADER, await csrfToken(superAdmin))
          .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });
        expect(suspended.status).toBe(200);
      }
      return rows;
    }) as never);

    const report = await app.sweep.run();

    expect(frozeMidSweep).toBe(true);
    expect(report.outcomes).toContainEqual({ name: 'orders.expirePaymentWindow', handled: 0, failed: false });
    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('AWAITING_PAYMENT');
  });
});

describe('the reservation survives days of normal, on-time progress (invariant 3’s ~13-day design)', () => {
  it('is still intact several days in when nobody has done anything wrong', async () => {
    const app = getApp();
    const { seller, buyer, order, variantId } = await freshOrder(app);

    // Shop takes nearly all of clock 1's 24h window to quote — legitimate, not a violation.
    app.clock.advanceByHours(23);
    await setShippingFee(seller, order.id, 2500);
    // Buyer takes nearly all of clock 2's 24h window to pay and upload a real slip. Total elapsed
    // since checkout so far: ~46 hours, entirely within the *current* clock's own window each
    // time — invariant 3's point exactly, that nothing here was ever one timer computed at checkout.
    app.clock.advanceByHours(23);
    await uploadSlip(buyer, order.id);

    // Sit comfortably inside clock 3's own 3-day window too. Total elapsed since checkout is now
    // pushing 5 days — still nothing has expired, because each clock only ever measures its own
    // start, never "time since checkout".
    app.clock.advanceByDays(2);
    await app.sweep.run();

    const after = await orderStatus(buyer, BUYER, order.id);
    expect(after.status).toBe('PAYMENT_SUBMITTED');

    // A second buyer still cannot take the unit — it is still reserved.
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, 'other-buyer@example.test');
    const otherAddressId = await createAddress(app, otherBuyer);
    await otherBuyer
      .post(`${API}/cart/items`)
      .set(CSRF_HEADER, await csrfToken(otherBuyer))
      .send({ variantId, quantity: 5 });
    const blocked = await checkoutAsShown(otherBuyer, otherAddressId);
    expect(blocked.status).toBe(409);
    expect((blocked.body as ErrorBody).code).toBe('CONFLICT');
  });
});
