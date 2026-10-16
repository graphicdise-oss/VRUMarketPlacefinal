import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { shownCartLines } from './helpers/order.js';

/**
 * #50 (invariant 3): stock is reserved the moment an order is created, and the real
 * `ProductVariant.stock` column is never touched here — the real cut is #55 (topic 8), when the
 * shop confirms payment. The one test this ticket calls out as the most important of the whole
 * ticket ("สองคนแย่งชิ้นสุดท้ายสำเร็จคนเดียว") fires two real concurrent HTTP requests, never
 * sequential ones — a sequential test would pass even with a broken read-then-write race.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER_A = 'buyer-a@example.test';
const BUYER_B = 'buyer-b@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
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

async function addToCart(client: Agent, variantId: string, quantity = 1) {
  return client
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ variantId, quantity });
}

async function checkout(client: Agent, addressId: string, token: string) {
  return client.post(`${API}/orders`).set(CSRF_HEADER, token).send({ addressId, items: await shownCartLines(client) });
}

describe('checking out reserves stock without ever touching ProductVariant.stock (invariant 3)', () => {
  it('creates a StockReservation matching the order item, and leaves stock untouched', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const variantId = product.variants[0]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER_A);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, variantId, 3);

    const response = await checkout(buyer, addressId, await csrfToken(buyer));

    expect(response.status).toBe(201);
    const orderId = (response.body as OrderBody[])[0]!.id;
    const reservation = await app.prisma.stockReservation.findFirst({
      where: { variantId, orderItem: { orderId } },
    });
    expect(reservation?.quantity).toBe(3);

    const variant = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.stock).toBe(10);
  });

  it('answers 409 and creates no order at all when there is not enough stock', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดของหายาก', 15000, 2);
    const variantId = product.variants[0]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER_A);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, variantId, 5);

    const response = await checkout(buyer, addressId, await csrfToken(buyer));

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
    const buyerUser = await app.prisma.user.findUniqueOrThrow({ where: { email: BUYER_A } });
    await expect(app.prisma.order.count({ where: { buyerId: buyerUser.id } })).resolves.toBe(0);
    await expect(app.prisma.stockReservation.count({ where: { variantId } })).resolves.toBe(0);
  });

  it('rolls back every order in the checkout if any one shop’s item can’t be reserved', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const sellerA = await sellerWithShop(app, 'seller-a@example.test', communityId);
    const sellerB = await sellerWithShop(app, 'seller-b@example.test', communityId);
    const plentyProduct = await approvedProduct(superAdmin, sellerA, categoryId, 'สินค้ามีของเยอะ', 10000, 100);
    const scarceProduct = await approvedProduct(superAdmin, sellerB, categoryId, 'สินค้ามีของน้อย', 20000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER_A);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, plentyProduct.variants[0]!.id, 1);
    await addToCart(buyer, scarceProduct.variants[0]!.id, 5);

    const response = await checkout(buyer, addressId, await csrfToken(buyer));

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
    await expect(app.prisma.order.count({ where: { buyerId: (await app.prisma.user.findUniqueOrThrow({ where: { email: BUYER_A } })).id } })).resolves.toBe(0);

    const cart = await buyer.get(`${API}/cart`);
    expect((cart.body as { items: unknown[] }).items).toHaveLength(2);
  });
});

describe('🚨 the test this whole ticket is about: two buyers racing the last unit — only one wins', () => {
  it('fires two real concurrent checkouts for the same single-stock variant; exactly one succeeds', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของชิ้นสุดท้าย', 15000, 1);
    const variantId = product.variants[0]!.id;

    const buyerA = newClient(app);
    await registerVerified(app, buyerA, BUYER_A);
    const addressA = await createAddress(app, buyerA);
    await addToCart(buyerA, variantId, 1);
    const tokenA = await csrfToken(buyerA);

    const buyerB = newClient(app);
    await registerVerified(app, buyerB, BUYER_B);
    const addressB = await createAddress(app, buyerB);
    await addToCart(buyerB, variantId, 1);
    const tokenB = await csrfToken(buyerB);

    const [responseA, responseB] = await Promise.all([
      checkout(buyerA, addressA, tokenA),
      checkout(buyerB, addressB, tokenB),
    ]);

    expect([responseA.status, responseB.status].sort()).toEqual([201, 409]);

    const reservations = await app.prisma.stockReservation.findMany({ where: { variantId } });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.quantity).toBe(1);
  });
});

describe('the reservation survives however long the clocks run — no expiresAt to fall back on (H3)', () => {
  it('still blocks a second buyer after 20 days pass, because nothing here is time-based', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของชิ้นสุดท้ายอีกใบ', 15000, 1);
    const variantId = product.variants[0]!.id;
    const buyerA = newClient(app);
    await registerVerified(app, buyerA, BUYER_A);
    const addressA = await createAddress(app, buyerA);
    await addToCart(buyerA, variantId, 1);
    await checkout(buyerA, addressA, await csrfToken(buyerA));

    app.clock.advanceByDays(20);

    const buyerB = newClient(app);
    await registerVerified(app, buyerB, BUYER_B);
    const addressB = await createAddress(app, buyerB);
    await addToCart(buyerB, variantId, 1);

    const response = await checkout(buyerB, addressB, await csrfToken(buyerB));

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });
});

describe('once an order leaves the reserving statuses, its stock frees up on its own (no release step to call)', () => {
  it('lets a second buyer purchase the same unit once the first order is CANCELLED', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของที่จะถูกยกเลิก', 15000, 1);
    const variantId = product.variants[0]!.id;
    const buyerA = newClient(app);
    await registerVerified(app, buyerA, BUYER_A);
    const addressA = await createAddress(app, buyerA);
    await addToCart(buyerA, variantId, 1);
    const firstCheckout = await checkout(buyerA, addressA, await csrfToken(buyerA));
    const firstOrderId = (firstCheckout.body as OrderBody[])[0]!.id;

    // The buyer's own cancel (#52) — a real path to CANCELLED, not a direct status write (§81).
    const cancelled = await buyerA
      .post(`${API}/orders/${firstOrderId}/cancel`)
      .set(CSRF_HEADER, await csrfToken(buyerA))
      .send({});
    expect(cancelled.status).toBe(200);

    const buyerB = newClient(app);
    await registerVerified(app, buyerB, BUYER_B);
    const addressB = await createAddress(app, buyerB);
    await addToCart(buyerB, variantId, 1);

    const response = await checkout(buyerB, addressB, await csrfToken(buyerB));

    expect(response.status).toBe(201);
  });

  it('once an order reaches PAID the real cut takes over from the reservation — the unit is counted once, never twice', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของที่จ่ายแล้ว', 15000, 2);
    const variantId = product.variants[0]!.id;
    const buyerA = newClient(app);
    await registerVerified(app, buyerA, BUYER_A);
    const addressA = await createAddress(app, buyerA);
    await addToCart(buyerA, variantId, 1);
    const firstCheckout = await checkout(buyerA, addressA, await csrfToken(buyerA));
    const firstOrderId = (firstCheckout.body as OrderBody[])[0]!.id;

    // §81: the real path to PAID (quote → real slip → shop confirms, #55), not a direct status
    // write. Written back when #55 didn't exist, this test could only show that PAID stops
    // counting as reserved; with the real cut in place it can show the whole handover.
    await seller
      .post(`${API}/shops/me/orders/${firstOrderId}/shipping-fee`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ shippingAmountMinor: 2000 });
    const slip = await buyerA
      .post(`${API}/orders/${firstOrderId}/payment-slips`)
      .set(CSRF_HEADER, await csrfToken(buyerA))
      .attach('file', await aJpegBuffer(), 'slip.jpg');
    expect(slip.status).toBe(201);
    const confirmed = await seller
      .post(`${API}/shops/me/orders/${firstOrderId}/confirm-payment`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({});
    expect(confirmed.status).toBe(200);

    // Stock 2 − 1 cut = 1 left. If the PAID order's reservation were *also* still counted, the
    // same unit would be subtracted twice and nothing would be left to sell.
    const buyerB = newClient(app);
    await registerVerified(app, buyerB, BUYER_B);
    const addressB = await createAddress(app, buyerB);
    await addToCart(buyerB, variantId, 1);
    const secondCheckout = await checkout(buyerB, addressB, await csrfToken(buyerB));
    expect(secondCheckout.status).toBe(201);

    // ...and that one remaining unit is now reserved by buyer B, so a third buyer gets nothing.
    const buyerC = newClient(app);
    await registerVerified(app, buyerC, 'buyer-c@example.test');
    const addressC = await createAddress(app, buyerC);
    await addToCart(buyerC, variantId, 1);
    const thirdCheckout = await checkout(buyerC, addressC, await csrfToken(buyerC));
    expect(thirdCheckout.status).toBe(409);
    expect((thirdCheckout.body as ErrorBody).code).toBe('CONFLICT');
  });
});

describe('a soft-deleted variant’s old reservation still resolves (L6)', () => {
  it('keeps the reservation and the order readable after the variant is soft-deleted', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const created = await seller
      .post(`${API}/products`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({
        name: 'สินค้าสองตัวเลือก',
        description: 'คำอธิบาย',
        categoryId,
        variants: [
          { name: 'ไซส์ M', priceAmountMinor: 15000, stock: 10 },
          { name: 'ไซส์ L', priceAmountMinor: 15000, stock: 10 },
        ],
      });
    const productId = (created.body as { id: string }).id;
    await approveProduct(superAdmin, productId);
    const fetched = await seller.get(`${API}/products/${productId}`);
    const variantToDelete = (fetched.body as ProductBody).variants[1]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER_A);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, variantToDelete, 1);
    const checkoutResponse = await checkout(buyer, addressId, await csrfToken(buyer));
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;

    await seller
      .delete(`${API}/products/${productId}/variants/${variantToDelete}`)
      .set(CSRF_HEADER, await csrfToken(seller));

    const reservation = await app.prisma.stockReservation.findFirst({ where: { variantId: variantToDelete } });
    expect(reservation).not.toBeNull();

    const order = await buyer.get(`${API}/orders/${orderId}`);
    expect(order.status).toBe(200);
  });
});
