import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #58 (F1/I15/K9/L5): the shop picks a courier from `ShippingCarrier`, enters a tracking number,
 * and every edit to that number after shipping is kept — the first ticket of topic 9.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';
const BUYER = 'buyer@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
  shippedAt: string | null;
  shippingCarrierId: string | null;
  shippingCarrierName: string | null;
  carrierNameOther: string | null;
  trackingNumber: string | null;
  trackingNumberHistory: { id: string; previousTrackingNumber: string; newTrackingNumber: string; changedAt: string }[];
}
interface CarrierBody {
  id: string;
  name: string;
  isOther: boolean;
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

/**
 * `isOther` has no HTTP path at all — see `ShippingCarrierService`'s own comment for why. In
 * production only `prisma/seed.ts` ever writes it; here the same seed-data role is played by a
 * direct insert, the same way `aRealSubdistrictPostalCodeId` reads seeded reference data straight
 * off `PrismaService` rather than through an endpoint that was never meant to exist.
 */
async function otherCarrier(app: TestApp): Promise<CarrierBody> {
  const row = await app.prisma.shippingCarrier.create({
    data: { id: newId(), name: 'อื่นๆ', isOther: true, createdAt: app.clock.now(), updatedAt: app.clock.now() },
  });
  return { id: row.id, name: row.name, isOther: row.isOther };
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

async function approvedProduct(
  superAdmin: Agent,
  seller: Agent,
  categoryId: string,
  name: string,
  variantName: string,
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
      variants: [{ name: variantName, priceAmountMinor, stock }],
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

async function ship(seller: Agent, orderId: string, body: { shippingCarrierId: string; carrierNameOther?: string; trackingNumber?: string }) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/ship`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send(body);
}

async function updateTrackingNumber(seller: Agent, orderId: string, trackingNumber: string) {
  return seller
    .patch(`${API}/shops/me/orders/${orderId}/tracking-number`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ trackingNumber });
}

async function suspendShop(superAdmin: Agent, shopId: string) {
  const response = await superAdmin.post(`${API}/shops/${shopId}/suspend`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });
  expect(response.status).toBe(200);
}

/** Freezes the buyer's orders the real way — a ban (I10) — without suspending the shop. */
async function freezeByBanningBuyer(superAdmin: Agent, buyer: Agent) {
  const buyerId = ((await buyer.get(`${API}/auth/me`)).body as { id: string }).id;
  const response = await superAdmin.post(`${API}/admin/users/${buyerId}/ban`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ reason: 'เหตุผลสำหรับทดสอบการแบนผู้ซื้อ' });
  expect(response.status).toBe(204);
}

/** Order placed, quoted, paid and confirmed — status PAID, ready to ship. */
async function orderPaid(
  app: TestApp,
): Promise<{ superAdmin: Agent; seller: Agent; shopId: string; buyer: Agent; order: OrderBody; carrier: CarrierBody }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const carrier = await createCarrier(superAdmin, 'Kerry');
  const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบจัดส่ง', 'สีแดง', 10000, 5);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
  await setShippingFee(seller, order.id, 2000);
  await uploadSlip(buyer, order.id);
  await confirmPayment(seller, order.id);
  const fetched = await seller.get(`${API}/orders/${order.id}`);

  return { superAdmin, seller, shopId, buyer, order: fetched.body as OrderBody, carrier };
}

describe('the shop ships — picks a carrier and records a tracking number (#58, F1/K9)', () => {
  it('moves PAID to SHIPPED, records shippedAt, the carrier and the tracking number', async () => {
    const app = getApp();
    const { seller, order, carrier } = await orderPaid(app);

    const response = await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });

    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.status).toBe('SHIPPED');
    expect(body.shippedAt).not.toBeNull();
    expect(body.shippingCarrierId).toBe(carrier.id);
    expect(body.shippingCarrierName).toBe('Kerry');
    expect(body.carrierNameOther).toBeNull();
    expect(body.trackingNumber).toBe('TH1234567890');
  });

  it('lets the shop pick "อื่นๆ" with a free-text carrier name (K9)', async () => {
    const app = getApp();
    const { seller, order } = await orderPaid(app);
    const other = await otherCarrier(app);

    const response = await ship(seller, order.id, {
      shippingCarrierId: other.id,
      carrierNameOther: 'ไปรเวทขนส่งท้องถิ่น',
      trackingNumber: 'LOCAL-001',
    });

    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.carrierNameOther).toBe('ไปรเวทขนส่งท้องถิ่น');
  });

  it('rejects "อื่นๆ" without a carrierNameOther', async () => {
    const app = getApp();
    const { seller, order } = await orderPaid(app);
    const other = await otherCarrier(app);

    const response = await ship(seller, order.id, { shippingCarrierId: other.id, trackingNumber: 'LOCAL-001' });

    expect(response.status).toBe(400);
  });

  it('rejects a real carrier paired with carrierNameOther — free text only makes sense for "อื่นๆ"', async () => {
    const app = getApp();
    const { seller, order, carrier } = await orderPaid(app);

    const response = await ship(seller, order.id, {
      shippingCarrierId: carrier.id,
      carrierNameOther: 'ชื่ออื่น',
      trackingNumber: 'TH1234567890',
    });

    expect(response.status).toBe(400);
  });

  it('rejects shipping with no carrier chosen or no tracking number entered', async () => {
    const app = getApp();
    const { seller, order, carrier } = await orderPaid(app);

    const noCarrier = await seller
      .post(`${API}/shops/me/orders/${order.id}/ship`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ trackingNumber: 'TH1234567890' });
    expect(noCarrier.status).toBe(400);

    const noTracking = await seller
      .post(`${API}/shops/me/orders/${order.id}/ship`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ shippingCarrierId: carrier.id });
    expect(noTracking.status).toBe(400);
  });

  it('rejects a carrier id that does not exist', async () => {
    const app = getApp();
    const { seller, order } = await orderPaid(app);

    const response = await ship(seller, order.id, {
      shippingCarrierId: '00000000-0000-7000-8000-000000000000',
      trackingNumber: 'TH1234567890',
    });

    expect(response.status).toBe(400);
  });

  it('rejects a carrier that has since been retired', async () => {
    const app = getApp();
    const { superAdmin, seller, order, carrier } = await orderPaid(app);
    await superAdmin
      .patch(`${API}/shipping-carriers/${carrier.id}`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ name: carrier.name, isActive: false });

    const response = await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });

    expect(response.status).toBe(400);
  });

  it('refuses shipping before PAID, and refuses shipping twice', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const carrier = await createCarrier(superAdmin, 'Kerry');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 'แบบเดียว', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);

    const tooEarly = await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });
    expect(tooEarly.status).toBe(409);

    await uploadSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    const first = await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });
    expect(first.status).toBe(200);

    const second = await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH0000000000' });
    expect(second.status).toBe(409);
  });

  it('refuses another shop’s order, or one that does not exist', async () => {
    const app = getApp();
    const { order, carrier } = await orderPaid(app);
    const superAdmin = app.client;
    const communityId = await createCommunity(superAdmin, 'ชุมชนอื่น');
    const { seller: otherSeller } = await sellerWithShop(app, OTHER_SELLER, communityId);

    const response = await ship(otherSeller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });

    expect(response.status).toBe(404);
  });

  it('lets a suspended shop ship normally — suspension blocks new sales, not finishing old ones (J2)', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, order, carrier } = await orderPaid(app);
    await suspendShop(superAdmin, shopId);

    const response = await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });

    expect(response.status).toBe(200);
  });

  it('lets the shop ship even while the order is frozen (invariant 7/J2)', async () => {
    const app = getApp();
    const { superAdmin, seller, buyer, order, carrier } = await orderPaid(app);
    await freezeByBanningBuyer(superAdmin, buyer);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).frozenAt).not.toBeNull();

    const response = await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });

    expect(response.status).toBe(200);
  });
});

describe('editing the tracking number after shipping keeps every prior value (#58, I15)', () => {
  it('records one history entry per edit, oldest first, visible to the buyer too', async () => {
    const app = getApp();
    const { seller, buyer, order, carrier } = await orderPaid(app);
    await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH-0001' });

    const afterFirstEdit = await updateTrackingNumber(seller, order.id, 'TH-0002');
    expect(afterFirstEdit.status).toBe(200);
    await updateTrackingNumber(seller, order.id, 'TH-0003');
    const afterThirdValue = await updateTrackingNumber(seller, order.id, 'TH-0004');

    expect(afterThirdValue.status).toBe(200);
    const body = afterThirdValue.body as OrderBody;
    expect(body.trackingNumber).toBe('TH-0004');
    expect(body.trackingNumberHistory).toHaveLength(3);
    expect(body.trackingNumberHistory.map((entry) => [entry.previousTrackingNumber, entry.newTrackingNumber])).toEqual([
      ['TH-0001', 'TH-0002'],
      ['TH-0002', 'TH-0003'],
      ['TH-0003', 'TH-0004'],
    ]);

    // The buyer sees the same history — not just the shop (this ticket's own AC).
    const buyerView = await buyer.get(`${API}/orders/${order.id}`);
    expect((buyerView.body as OrderBody).trackingNumberHistory).toHaveLength(3);
  });

  it('refuses editing before the order has shipped', async () => {
    const app = getApp();
    const { seller, order } = await orderPaid(app);

    const response = await updateTrackingNumber(seller, order.id, 'TH-0002');

    expect(response.status).toBe(409);
  });

  it('refuses editing once the buyer has marked the order received', async () => {
    const app = getApp();
    const { seller, buyer, order, carrier } = await orderPaid(app);
    await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH-0001' });
    expect((await buyer.post(`${API}/orders/${order.id}/receive`).set(CSRF_HEADER, await csrfToken(buyer))).status).toBe(200);

    const response = await updateTrackingNumber(seller, order.id, 'TH-0002');

    expect(response.status).toBe(409);
  });

  it('refuses another shop’s order', async () => {
    const app = getApp();
    const { seller, order, carrier } = await orderPaid(app);
    await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH-0001' });
    const superAdmin = app.client;
    const communityId = await createCommunity(superAdmin, 'ชุมชนอื่น');
    const { seller: otherSeller } = await sellerWithShop(app, OTHER_SELLER, communityId);

    const response = await updateTrackingNumber(otherSeller, order.id, 'TH-0002');

    expect(response.status).toBe(404);
  });

  it('lets a suspended shop, or a frozen order, still edit the tracking number (J2)', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, order, carrier } = await orderPaid(app);
    await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH-0001' });
    await suspendShop(superAdmin, shopId); // freezes the order too (H2)
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).frozenAt).not.toBeNull();

    const response = await updateTrackingNumber(seller, order.id, 'TH-0002');

    expect(response.status).toBe(200);
  });
});

describe('code review of topic 9 (§85)', () => {
  interface HistoryBody {
    trackingNumberHistory: { previousTrackingNumber: string; newTrackingNumber: string }[];
    trackingNumber: string;
    shippingCarrierName: string | null;
  }

  it('three tracking-number edits at once still leave an unbroken history — each change starts where the one before it ended (I15)', async () => {
    const app = getApp();
    const { seller, order, carrier } = await orderPaid(app);
    await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH0000000000' });

    await Promise.all([
      updateTrackingNumber(seller, order.id, 'TH0000000001'),
      updateTrackingNumber(seller, order.id, 'TH0000000002'),
      updateTrackingNumber(seller, order.id, 'TH0000000003'),
    ]);

    const body = (await seller.get(`${API}/orders/${order.id}`)).body as HistoryBody;
    let expectedPrevious = 'TH0000000000';
    for (const change of body.trackingNumberHistory) {
      expect(change.previousTrackingNumber).toBe(expectedPrevious);
      expectedPrevious = change.newTrackingNumber;
    }
    expect(body.trackingNumber).toBe(expectedPrevious);
  });

  it('renaming a carrier later does not rewrite the name on orders already shipped with it (invariant 5)', async () => {
    const app = getApp();
    const { superAdmin, seller, buyer, order, carrier } = await orderPaid(app);
    await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });

    await superAdmin
      .patch(`${API}/shipping-carriers/${carrier.id}`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ name: 'Kerry Express (ชื่อใหม่)', isActive: true });

    const body = (await buyer.get(`${API}/orders/${order.id}`)).body as HistoryBody;
    expect(body.shippingCarrierName).toBe('Kerry');
  });

  it('after closing and reopening, the owner still manages the old shop’s shipped order — sees it, corrects its tracking number (I15)', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, order, carrier } = await orderPaid(app);
    await ship(seller, order.id, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });
    expect((await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller))).status).toBe(200);
    const otherCommunity = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    await seller.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(seller)).send({ communityId: otherCommunity, name: 'ร้านใหม่' });

    const list = (await seller.get(`${API}/shops/me/orders`)).body as { items: { id: string }[] };
    const edit = await updateTrackingNumber(seller, order.id, 'TH9999999999');

    expect(list.items.map((item) => item.id)).toContain(order.id);
    expect(edit.status).toBe(200);
  });
});
