import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #56 (I2): the shop's other option besides confirming — reject a slip with a mandatory reason,
 * capped at 2 per order because the button also restarts clock 2 (and, via #57, clock 3's own
 * round) and an unbounded cap would let a shop dodge REFUND_ORDERED forever.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';
const BUYER = 'buyer@example.test';

interface OrderBody {
  id: string;
  buyerId: string;
  status: string;
  expiresAt: string | null;
  slipRejectionCount: number;
  slipRejectionsRemaining: number;
}
interface SlipBody {
  id: string;
  rejectedAt: string | null;
  rejectionReason: string | null;
  supersededAt: string | null;
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

async function approvedProduct(superAdmin: Agent, seller: Agent, categoryId: string, name: string): Promise<{ id: string; variantId: string }> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name,
      description: 'คำอธิบายสินค้าสำหรับทดสอบ',
      categoryId,
      variants: [{ name: 'แบบเดียว', priceAmountMinor: 10000, stock: 5 }],
    });
  const productId = (created.body as { id: string }).id;
  await approveProduct(superAdmin, productId);

  const fetched = await seller.get(`${API}/products/${productId}`);
  const body = fetched.body as { variants: { id: string }[] };

  return { id: productId, variantId: body.variants[0]!.id };
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

async function uploadSlip(buyer: Agent, orderId: string): Promise<SlipBody> {
  const response = await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');

  return response.body as SlipBody;
}

/**
 * `ACCESS_TOKEN_TTL_MINUTES` is 15 — the clock-2-restart test moves the clock by hours, so the
 * seller's cookie from earlier in the test is long expired by the time this call happens. Same
 * concern and fix `order-sweep.spec.ts`'s own `setShippingFee` helper already documents: re-login
 * (the same account, a fresh session) before every call here, not just in the one test that needs it.
 */
async function rejectSlip(
  seller: Agent,
  sellerEmail: string,
  orderId: string,
  slipId: string,
  reason = 'ยอดโอนไม่ตรงกับยอดที่ต้องชำระ กรุณาตรวจสอบและโอนใหม่',
) {
  await login(seller, sellerEmail);

  return seller
    .post(`${API}/shops/me/orders/${orderId}/payment-slips/${slipId}/reject`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ reason });
}

/** Order placed, quoted, and paid (a slip uploaded) — status PAYMENT_SUBMITTED, ready to reject. */
async function orderPaymentSubmitted(app: TestApp): Promise<{ seller: Agent; shopId: string; buyer: Agent; order: OrderBody; slip: SlipBody }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบปฏิเสธสลิป');
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, product.variantId);
  await setShippingFee(seller, order.id, 2000);
  const slip = await uploadSlip(buyer, order.id);

  return { seller, shopId, buyer, order, slip };
}

describe('the shop rejects a slip — sends the order back, no more than twice (#56, I2)', () => {
  it('rejects with a reason, regresses the order to AWAITING_PAYMENT, and the buyer sees the reason', async () => {
    const app = getApp();
    const { seller, buyer, order, slip } = await orderPaymentSubmitted(app);
    const reason = 'ยอดโอนไม่ตรงกับยอดที่ต้องชำระ กรุณาตรวจสอบและโอนใหม่';

    const response = await rejectSlip(seller, SELLER, order.id, slip.id, reason);

    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.status).toBe('AWAITING_PAYMENT');
    expect(body.slipRejectionCount).toBe(1);
    expect(body.slipRejectionsRemaining).toBe(1);

    const slipsView = await buyer.get(`${API}/orders/${order.id}/payment-slips`);
    const buyerSlip = (slipsView.body as SlipBody[]).find((s) => s.id === slip.id)!;
    expect(buyerSlip.rejectedAt).not.toBeNull();
    expect(buyerSlip.rejectionReason).toBe(reason);
  });

  it('rejects a missing or empty reason', async () => {
    const app = getApp();
    const { seller, order, slip } = await orderPaymentSubmitted(app);

    const missing = await seller
      .post(`${API}/shops/me/orders/${order.id}/payment-slips/${slip.id}/reject`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({});
    expect(missing.status).toBe(400);

    const empty = await rejectSlip(seller, SELLER, order.id, slip.id, '');
    expect(empty.status).toBe(400);
  });

  it('restarts clock 2 to a full 24h window, not whatever time was left', async () => {
    const app = getApp();
    const { seller, order, slip } = await orderPaymentSubmitted(app);
    // Burn most of the original 24h window before rejecting.
    app.clock.advanceByHours(20);

    const response = await rejectSlip(seller, SELLER, order.id, slip.id);

    const body = response.body as OrderBody;
    const expiresAt = new Date(body.expiresAt!).getTime();
    const now = app.clock.now().getTime();
    const hoursLeft = (expiresAt - now) / (60 * 60 * 1000);
    expect(hoursLeft).toBeCloseTo(24, 1);
  });

  it('caps rejections at 2 per order — the 3rd is refused, and the count/remaining fields track it exactly', async () => {
    const app = getApp();
    const { seller, buyer, order, slip: slip1 } = await orderPaymentSubmitted(app);

    const first = await rejectSlip(seller, SELLER, order.id, slip1.id);
    expect(first.status).toBe(200);
    expect((first.body as OrderBody).slipRejectionCount).toBe(1);
    expect((first.body as OrderBody).slipRejectionsRemaining).toBe(1);

    const slip2 = await uploadSlip(buyer, order.id);
    const second = await rejectSlip(seller, SELLER, order.id, slip2.id);
    expect(second.status).toBe(200);
    expect((second.body as OrderBody).slipRejectionCount).toBe(2);
    expect((second.body as OrderBody).slipRejectionsRemaining).toBe(0);

    const slip3 = await uploadSlip(buyer, order.id);
    const third = await rejectSlip(seller, SELLER, order.id, slip3.id);
    expect(third.status).toBe(409);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('PAYMENT_SUBMITTED'); // the 3rd attempt never regressed it
    const rejectedCount = await app.prisma.paymentSlip.count({ where: { orderId: order.id, rejectedAt: { not: null } } });
    expect(rejectedCount).toBe(2);
  });

  it('refuses rejecting a slip once the shop has already confirmed payment (PAID)', async () => {
    const app = getApp();
    const { seller, order, slip } = await orderPaymentSubmitted(app);
    const confirmed = await seller
      .post(`${API}/shops/me/orders/${order.id}/confirm-payment`)
      .set(CSRF_HEADER, await csrfToken(seller));
    expect(confirmed.status).toBe(200);

    const response = await rejectSlip(seller, SELLER, order.id, slip.id);

    expect(response.status).toBe(409);
  });

  it('refuses rejecting an already-rejected slip a second time, even from a fresh round', async () => {
    const app = getApp();
    const { seller, buyer, order, slip: slip1 } = await orderPaymentSubmitted(app);
    await rejectSlip(seller, SELLER, order.id, slip1.id);
    const slip2 = await uploadSlip(buyer, order.id); // fresh round, PAYMENT_SUBMITTED again

    const response = await rejectSlip(seller, SELLER, order.id, slip1.id); // targets the OLD, already-rejected slip

    expect(response.status).toBe(404);
    // The fresh slip is still rejectable normally.
    const freshReject = await rejectSlip(seller, SELLER, order.id, slip2.id);
    expect(freshReject.status).toBe(200);
  });

  it('refuses rejecting a leftover slip from an earlier round, and marks it superseded instead (§82)', async () => {
    const app = getApp();
    const { seller, buyer, order, slip: first } = await orderPaymentSubmitted(app);
    const reupload = await uploadSlip(buyer, order.id); // same round — the buyer sent a second picture
    await rejectSlip(seller, SELLER, order.id, first.id); // ends the round
    const nextRound = await uploadSlip(buyer, order.id);

    // Before §82 this answered 200: the leftover from round one knocked back round two and spent
    // the shop's second (last) rejection on a transfer that was already dealt with.
    const stale = await rejectSlip(seller, SELLER, order.id, reupload.id);

    expect(stale.status).toBe(409);
    const slips = (await buyer.get(`${API}/orders/${order.id}/payment-slips`)).body as SlipBody[];
    const byId = new Map(slips.map((slip) => [slip.id, slip]));
    expect(byId.get(first.id)?.rejectedAt).not.toBeNull();
    expect(byId.get(first.id)?.supersededAt).toBeNull(); // rejected itself, not superseded
    expect(byId.get(reupload.id)?.rejectedAt).toBeNull();
    expect(byId.get(reupload.id)?.supersededAt).not.toBeNull();
    expect(byId.get(nextRound.id)?.supersededAt).toBeNull();
    // The current round is untouched and still rejectable, with one rejection left.
    const current = await rejectSlip(seller, SELLER, order.id, nextRound.id);
    expect(current.status).toBe(200);
    expect((current.body as OrderBody).slipRejectionsRemaining).toBe(0);
  });

  it('refuses for another shop’s order, or a slip that isn’t on this order', async () => {
    const app = getApp();
    const { order, slip } = await orderPaymentSubmitted(app);
    const superAdmin = app.client;
    const communityId = await createCommunity(superAdmin, 'ชุมชนอื่น');
    const { seller: otherSeller } = await sellerWithShop(app, OTHER_SELLER, communityId);

    const response = await rejectSlip(otherSeller, OTHER_SELLER, order.id, slip.id);

    expect(response.status).toBe(404);
  });

  it('lets a suspended shop reject normally — suspension blocks new sales, not finishing old ones (J2)', async () => {
    const app = getApp();
    const { seller, shopId, order, slip } = await orderPaymentSubmitted(app);
    // The real suspension path (§82 — used to be a direct `suspendedAt` write). Suspending also
    // freezes the shop's open orders (invariant 7), which this action must survive too.
    const suspended = await app.client
      .post(`${API}/shops/${shopId}/suspend`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });
    expect(suspended.status).toBe(200);

    const response = await rejectSlip(seller, SELLER, order.id, slip.id);

    expect(response.status).toBe(200);
  });

  it('lets the shop reject even while the order is frozen — this keeps the deal moving, it doesn’t end it', async () => {
    const app = getApp();
    const { seller, order, slip } = await orderPaymentSubmitted(app);
    // A real freeze with the shop left alone (§82 — used to be a direct `frozenAt` write): a super
    // admin bans the buyer, which freezes the buyer's open orders (invariant 7, I10).
    const banned = await app.client
      .post(`${API}/admin/users/${order.buyerId}/ban`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ reason: 'เหตุผลสำหรับทดสอบการแบนผู้ซื้อ' });
    expect(banned.status).toBe(204);

    const response = await rejectSlip(seller, SELLER, order.id, slip.id);

    expect(response.status).toBe(200);
  });
});
