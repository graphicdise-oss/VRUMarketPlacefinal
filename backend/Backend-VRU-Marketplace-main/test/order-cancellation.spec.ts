import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #52 (D4 · H11 · H5): both sides can cancel by hand, but only before money starts moving. The
 * deadline is the buyer uploading a slip. When this file was written `PaymentSlip` (topic 8) and
 * freezing (topic 10) didn't exist, so both states were written straight through Prisma; code
 * review of topic 7 (§81) moved every arrangement here onto the real paths — a real slip upload,
 * a real shop suspension — now that they exist.
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
  cancelledBy: string | null;
  cancelReason: string | null;
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

async function setShippingFee(seller: Agent, orderId: string, shippingAmountMinor: number) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingAmountMinor });
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

/** The real topic-8 transition into PAYMENT_SUBMITTED (§81 — used to be a direct Prisma write). */
async function uploadSlip(buyer: Agent, orderId: string): Promise<void> {
  const response = await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
  expect(response.status).toBe(201);
}

async function cancelAsBuyer(buyer: Agent, orderId: string, reason?: string) {
  return buyer
    .post(`${API}/orders/${orderId}/cancel`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send(reason === undefined ? {} : { reason });
}

async function cancelAsShop(seller: Agent, orderId: string, reason?: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/cancel`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send(reason === undefined ? {} : { reason });
}

describe('the buyer can cancel before money moves (D4)', () => {
  it('cancels from AWAITING_SHIPPING_QUOTE with no reason required, and frees the reservation', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบยกเลิกผู้ซื้อ', 10000, 1);
    const variantId = product.variants[0]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, variantId, 1);
    expect(order.status).toBe('AWAITING_SHIPPING_QUOTE');

    const response = await cancelAsBuyer(buyer, order.id);

    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.status).toBe('CANCELLED');
    expect(body.cancelledBy).toBe('BUYER');
    expect(body.cancelReason).toBeNull();

    // Reservation released for real — a second buyer can take the same unit.
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, 'other-buyer@example.test');
    const secondOrder = await placeOrder(app, otherBuyer, variantId, 1);
    expect(secondOrder.status).toBe('AWAITING_SHIPPING_QUOTE');
  });

  it('accepts an optional reason and shows it to the shop', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบเหตุผลผู้ซื้อ', 10000, 2);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    await cancelAsBuyer(buyer, order.id, 'สั่งผิดสี');

    const shopView = await seller.get(`${API}/orders/${order.id}`);
    expect((shopView.body as OrderBody).cancelReason).toBe('สั่งผิดสี');
  });

  it('also cancels from AWAITING_PAYMENT (after the shop quoted shipping)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบยกเลิกหลังใส่ค่าส่ง', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 3000);

    const response = await cancelAsBuyer(buyer, order.id);

    expect(response.status).toBe(200);
    expect((response.body as OrderBody).status).toBe('CANCELLED');
  });
});

describe('a blank buyer reason means "no reason", not a validation error (§81)', () => {
  it('cancels when the form sends an empty or whitespace-only reason, and stores null', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบเหตุผลว่าง', 10000, 2);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    const response = await cancelAsBuyer(buyer, order.id, '   ');

    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.status).toBe('CANCELLED');
    expect(body.cancelReason).toBeNull();
  });
});

describe('the shop can cancel before money moves, but only with a reason (H11)', () => {
  it('cancels with a valid reason, recorded and visible to the buyer', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบยกเลิกร้าน', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    const response = await cancelAsShop(seller, order.id, 'สินค้าหมดสต็อกกะทันหัน ขออภัยในความไม่สะดวก');

    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.status).toBe('CANCELLED');
    expect(body.cancelledBy).toBe('SHOP');
    expect(body.cancelReason).toBe('สินค้าหมดสต็อกกะทันหัน ขออภัยในความไม่สะดวก');

    const buyerView = await buyer.get(`${API}/orders/${order.id}`);
    expect((buyerView.body as OrderBody).cancelReason).toBe('สินค้าหมดสต็อกกะทันหัน ขออภัยในความไม่สะดวก');
  });

  it('rejects the cancel itself when no reason is given (validation, tested both ways)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบร้านไม่ใส่เหตุผล', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    const withoutReason = await cancelAsShop(seller, order.id, undefined);
    expect(withoutReason.status).toBe(400);

    const withReason = await cancelAsShop(seller, order.id, 'เหตุผลที่ยาวพอสำหรับทดสอบ');
    expect(withReason.status).toBe(200);
    expect((withReason.body as OrderBody).status).toBe('CANCELLED');
  });

  it('is the shop’s only way out of a shipping fee entered wrong (H1 forbids editing it)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบใส่ค่าส่งผิด', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 999999);

    const response = await cancelAsShop(seller, order.id, 'ใส่ค่าส่งผิดพลาด พิมพ์เลขเกินไปมาก');

    expect(response.status).toBe(200);
    expect((response.body as OrderBody).status).toBe('CANCELLED');
  });
});

describe('once cancelled or already resolved, cancelling again is refused', () => {
  it('cannot cancel an order that is already CANCELLED', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบยกเลิกซ้ำ', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await cancelAsBuyer(buyer, order.id);

    const second = await cancelAsBuyer(buyer, order.id);

    expect(second.status).toBe(409);
  });
});

describe('after the buyer uploads a slip, neither side can cancel unilaterally (H5)', () => {
  it('refuses the buyer’s cancel once status is PAYMENT_SUBMITTED', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบหลังอัปสลิปผู้ซื้อ', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);

    const response = await cancelAsBuyer(buyer, order.id);

    expect(response.status).toBe(409);
  });

  it('refuses the shop’s cancel once status is PAYMENT_SUBMITTED, even with a valid reason', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบหลังอัปสลิปร้าน', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);

    const response = await cancelAsShop(seller, order.id, 'เหตุผลที่ยาวพอสำหรับทดสอบ');

    expect(response.status).toBe(409);
  });
});

describe('a frozen order cannot be cancelled by hand — the admin still has to rule (topic 10)', () => {
  it('refuses both sides once the order is frozen by its shop being suspended', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบแช่แข็ง', 10000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    // The real freeze path (invariant 7), not a direct `frozenAt` write (§81).
    const suspended = await superAdmin
      .post(`${API}/shops/${order.shopId}/suspend`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });
    expect(suspended.status).toBe(200);

    const buyerAttempt = await cancelAsBuyer(buyer, order.id);
    expect(buyerAttempt.status).toBe(409);

    const shopAttempt = await cancelAsShop(seller, order.id, 'เหตุผลที่ยาวพอสำหรับทดสอบ');
    expect(shopAttempt.status).toBe(409);

    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('AWAITING_SHIPPING_QUOTE');
  });
});
