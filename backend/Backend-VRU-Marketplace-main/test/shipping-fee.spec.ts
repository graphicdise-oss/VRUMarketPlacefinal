import type { Agent } from 'supertest';
import sharp from 'sharp';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #51 (H1 · E2b): the shop's one chance to quote shipping, locked the moment it's set, and the
 * buyer's one chance to walk away from that quote. This is also the point where invariant 4's
 * `totalAmountMinor` finally stops being null, and where clock 2 (#53) starts counting.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'other-buyer@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
  totalAmountMinor: number | null;
  shippingAmountMinor: number | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  items: { quantity: number; priceAtPurchase: number }[];
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

/** Places one order for `variantId` × `quantity`, returning it. Buyer must already be verified. */
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

async function rejectShippingFee(buyer: Agent, orderId: string, reason?: string) {
  return buyer
    .post(`${API}/orders/${orderId}/reject-shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send(reason === undefined ? {} : { reason });
}

describe('the shop sets the shipping fee once, and it locks (H1)', () => {
  it('sets a total (items + shipping) and moves the order to AWAITING_PAYMENT, starting clock 2', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 2);
    expect(order.status).toBe('AWAITING_SHIPPING_QUOTE');
    expect(order.totalAmountMinor).toBeNull();

    // AC: the shop must see the items and destination before quoting — same order the buyer
    // just placed, read back through the shop's own view (`GET /orders/:id` serves both sides).
    const shopView = await seller.get(`${API}/orders/${order.id}`);
    expect(shopView.status).toBe(200);
    expect((shopView.body as { items: unknown[] }).items).toHaveLength(1);
    expect((shopView.body as { recipientName: string }).recipientName).toBe('สมชาย ใจดี');

    const response = await setShippingFee(seller, order.id, 4000);

    expect(response.status).toBe(200);
    const updated = response.body as OrderBody;
    expect(updated.status).toBe('AWAITING_PAYMENT');
    expect(updated.shippingAmountMinor).toBe(4000);
    expect(updated.totalAmountMinor).toBe(15000 * 2 + 4000);
  });

  it('rejects a second attempt to set the fee — already locked, even to fix a typo (409)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบล็อก', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 3000);

    const second = await setShippingFee(seller, order.id, 9999);

    expect(second.status).toBe(409);
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    // The first value survives untouched — the second call changed nothing.
    expect(row.shippingAmountMinor).toBe(3000);
    expect(row.totalAmountMinor).toBe(13000);
  });

  it('lets the shop owner set the fee even while their shop is suspended (J2 · flagged by #38)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของร้านที่ถูกระงับ', 12000, 3);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    await superAdmin
      .post(`${API}/shops/${shopId}/suspend`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });

    const response = await setShippingFee(seller, order.id, 2500);

    expect(response.status).toBe(200);
    expect((response.body as OrderBody).shippingAmountMinor).toBe(2500);
  });
});

describe('the buyer may reject the shipping fee instead of paying it (E2b)', () => {
  it('cancels the order immediately and frees the stock reservation when a reason is given', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของที่จะถูกปฏิเสธค่าส่ง', 8000, 1);
    const variantId = product.variants[0]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, variantId, 1);
    await setShippingFee(seller, order.id, 5000);

    const response = await rejectShippingFee(buyer, order.id, 'ค่าส่งแพงกว่าที่คาดไว้มาก ไม่สะดวกจ่ายเพิ่ม');

    expect(response.status).toBe(200);
    expect((response.body as OrderBody).status).toBe('CANCELLED');

    // #50's own design: the `StockReservation` row is never deleted — "released" means the live
    // sum computed from `Order.status` no longer counts it, which is provable only by trying to
    // take the same unit again, not by counting rows (the row for the cancelled order still exists).
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);
    const secondOrder = await placeOrder(app, otherBuyer, variantId, 1);
    expect(secondOrder.status).toBe('AWAITING_SHIPPING_QUOTE');
  });

  it('records the reason in a queryable row, not a single opaque blob', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบสถิติ', 6000, 2);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 1500);

    await rejectShippingFee(buyer, order.id, 'เปลี่ยนใจไม่อยากได้ของแล้วหลังเห็นค่าส่ง');

    const row = await app.prisma.shippingFeeRejection.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(row.reason).toBe('เปลี่ยนใจไม่อยากได้ของแล้วหลังเห็นค่าส่ง');
  });

  it('rejects the rejection itself when no reason is given (validation, not a silent default)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบไม่ใส่เหตุผล', 7000, 2);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 1000);

    const response = await rejectShippingFee(buyer, order.id, undefined);

    expect(response.status).toBe(400);
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('AWAITING_PAYMENT');
  });

  it('answers 409 once there is no shipping-fee decision pending (already accepted-by-inaction, or never quoted)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบสถานะผิด', 9000, 2);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    // No shipping fee set yet — still AWAITING_SHIPPING_QUOTE, nothing to reject.

    const response = await rejectShippingFee(buyer, order.id, 'เหตุผลอะไรสักอย่าง');

    expect(response.status).toBe(409);
  });
});

describe('shipping fee and its rejection — code review of topic 7 (§81)', () => {
  it('refuses a fee over 100,000 baht with a field error instead of a 500, and still accepts exactly the cap', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'กระเป๋าสานใบลาน', 15000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    const tooHigh = await setShippingFee(seller, order.id, 10_000_001);

    expect(tooHigh.status).toBe(400);
    expect((tooHigh.body as { code: string }).code).toBe('VALIDATION_FAILED');
    expect((tooHigh.body as { fieldErrors?: Record<string, string> }).fieldErrors?.shippingAmountMinor).toBeDefined();
    const untouched = await seller.get(`${API}/orders/${order.id}`);
    expect((untouched.body as OrderBody).status).toBe('AWAITING_SHIPPING_QUOTE');

    const atCap = await setShippingFee(seller, order.id, 10_000_000);
    expect(atCap.status).toBe(200);
    expect((atCap.body as OrderBody).totalAmountMinor).toBe(15000 + 10_000_000);
  });

  it('shows the shop who ended the order and why when the buyer rejects the fee', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'หมวกสานกันแดด', 9000, 2);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 6000);

    await rejectShippingFee(buyer, order.id, 'ค่าส่งแพงกว่าราคาสินค้าเกือบเท่าตัว');

    // Before §81 this read CANCELLED / null / null — exactly what a sweep timeout looks like.
    const shopView = await seller.get(`${API}/orders/${order.id}`);
    const body = shopView.body as OrderBody;
    expect(body.status).toBe('CANCELLED');
    expect(body.cancelledBy).toBe('BUYER');
    expect(body.cancelReason).toBe('ค่าส่งแพงกว่าราคาสินค้าเกือบเท่าตัว');
  });

  it('refuses to reject the fee of a frozen order — the admin still has to rule (#52)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ตะกร้าหวายสาน', 11000, 2);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 3000);
    // The real freeze path (invariant 7): suspending the shop freezes its open orders.
    await superAdmin
      .post(`${API}/shops/${shopId}/suspend`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });

    const response = await rejectShippingFee(buyer, order.id, 'ค่าส่งแพงเกินไปสำหรับของชิ้นเดียว');

    expect(response.status).toBe(409);
    const after = await buyer.get(`${API}/orders/${order.id}`);
    expect((after.body as OrderBody).status).toBe('AWAITING_PAYMENT');
    expect((after.body as { displayStatus: string }).displayStatus).toBe('FROZEN');
  });
});

describe('the buyer sees the shop’s payment channels once there is something to pay (L1)', () => {
  it('returns the channels once AWAITING_PAYMENT, to this order’s own buyer only', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    await seller
      .post(`${API}/shops/me/payment-channels`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ type: 'PROMPTPAY', promptPayId: '0899999999' });
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบช่องทางจ่าย', 5000, 3);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    const beforeQuote = await buyer.get(`${API}/orders/${order.id}/payment-channels`);
    expect(beforeQuote.status).toBe(404);

    await setShippingFee(seller, order.id, 2000);
    const afterQuote = await buyer.get(`${API}/orders/${order.id}/payment-channels`);

    expect(afterQuote.status).toBe(200);
    const channels = afterQuote.body as { type: string; promptPayId: string | null }[];
    expect(channels).toHaveLength(1);
    expect(channels[0]!.promptPayId).toBe('0899999999');

    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);
    const deniedForOtherBuyer = await otherBuyer.get(`${API}/orders/${order.id}/payment-channels`);
    expect(deniedForOtherBuyer.status).toBe(404);
  });
});

/**
 * Code review of topic 4 (2026-09-22, §77): #36 never built a buyer-facing way to fetch a QR
 * image's bytes, so `hasQrImage: true` in the list above was a dead end for the one buyer L1
 * entitles to see it — this is that missing route.
 */
describe('the buyer can fetch a payment channel’s QR image bytes, same gate as the list (§77)', () => {
  it('returns the image once AWAITING_PAYMENT, to this order’s own buyer only', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const created = await seller
      .post(`${API}/shops/me/payment-channels`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ type: 'PROMPTPAY', promptPayId: '0899999999' });
    const channelId = (created.body as { id: string }).id;
    const qrBytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .jpeg()
      .toBuffer();
    await seller
      .post(`${API}/shops/me/payment-channels/${channelId}/qr-image`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', qrBytes, 'qr.jpg');

    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ QR', 5000, 3);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    const beforeQuote = await buyer.get(`${API}/orders/${order.id}/payment-channels/${channelId}/qr-image`);
    expect(beforeQuote.status).toBe(404);

    await setShippingFee(seller, order.id, 2000);
    const response = await buyer.get(`${API}/orders/${order.id}/payment-channels/${channelId}/qr-image`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect((response.body as Buffer).length).toBeGreaterThan(0);

    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);
    const denied = await otherBuyer.get(`${API}/orders/${order.id}/payment-channels/${channelId}/qr-image`);
    expect(denied.status).toBe(404);
  });

  it('answers 404 for a channel that has no QR image, and for a channel id from another shop', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const created = await seller
      .post(`${API}/shops/me/payment-channels`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ type: 'PROMPTPAY', promptPayId: '0899999999' });
    const channelWithNoImage = (created.body as { id: string }).id;

    const { seller: otherSeller } = await sellerWithShop(app, 'other-seller-qr@example.test', communityId);
    const otherChannel = await otherSeller
      .post(`${API}/shops/me/payment-channels`)
      .set(CSRF_HEADER, await csrfToken(otherSeller))
      .send({ type: 'PROMPTPAY', promptPayId: '0888888888' });
    const channelOnAnotherShop = (otherChannel.body as { id: string }).id;

    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ QR ว่าง', 5000, 3);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);

    const noImage = await buyer.get(`${API}/orders/${order.id}/payment-channels/${channelWithNoImage}/qr-image`);
    expect(noImage.status).toBe(404);

    const wrongShop = await buyer.get(`${API}/orders/${order.id}/payment-channels/${channelOnAnotherShop}/qr-image`);
    expect(wrongShop.status).toBe(404);
  });
});
