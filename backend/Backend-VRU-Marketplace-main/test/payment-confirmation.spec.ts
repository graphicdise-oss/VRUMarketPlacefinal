import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #55 (K8): the only place in the system that ever cuts real stock, and the only place
 * `Order.status` ever becomes `PAID`. Builds on #54's slip upload to reach `PAYMENT_SUBMITTED`
 * for real, through HTTP, rather than a direct Prisma write — unlike #54's own tests, which had
 * to simulate `PAID` because this ticket didn't exist yet.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';
const BUYER = 'buyer@example.test';
const BUYER_B = 'buyer-b@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  buyerId: string;
  status: string;
  sellerConfirmedAt: string | null;
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

/** #44's real edit endpoint — a price/stock-only change (invariant 6's second group) takes effect immediately. */
async function setVariantStock(seller: Agent, productId: string, variant: { id: string; name: string; priceAmountMinor: number }, stock: number) {
  // §91: the stock the seller's form is showing right now, read the way the form reads it.
  const shown = ((await seller.get(`${API}/products/${productId}`)).body as { variants: { id: string; stock: number }[] }).variants;
  const expectedStock = shown.find((row) => row.id === variant.id)?.stock;
  return seller
    .patch(`${API}/products/${productId}/variants/${variant.id}`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ name: variant.name, priceAmountMinor: variant.priceAmountMinor, stock, expectedStock });
}

/** Order placed, quoted, and paid (a slip uploaded) — status PAYMENT_SUBMITTED, ready to confirm. */
async function orderPaymentSubmitted(
  app: TestApp,
  quantity = 1,
  stock = 5,
): Promise<{ seller: Agent; shopId: string; buyer: Agent; order: OrderBody; product: ProductBody; variant: ProductBody['variants'][0] }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบยืนยันเงิน', 'สีแดง', 10000, stock);
  const variant = product.variants[0]!;
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, variant.id, quantity);
  await setShippingFee(seller, order.id, 2000);
  await uploadSlip(buyer, order.id);

  return { seller, shopId, buyer, order, product, variant };
}

describe('the shop confirms payment received — cuts real stock, the only place that does (#55, K8)', () => {
  it('cuts the variant’s stock, sets sellerConfirmedAt/By, and moves the order to PAID', async () => {
    const app = getApp();
    const { seller, order, variant } = await orderPaymentSubmitted(app, 2, 5);
    const sellerUserId = (await app.prisma.user.findUniqueOrThrow({ where: { email: SELLER } })).id;

    const response = await confirmPayment(seller, order.id);

    expect(response.status).toBe(200);
    const body = response.body as OrderBody;
    expect(body.status).toBe('PAID');
    expect(body.sellerConfirmedAt).not.toBeNull();
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.sellerConfirmedBy).toBe(sellerUserId);
    const variantRow = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantRow.stock).toBe(3); // 5 - 2
  });

  it('frees up the reserved quantity for other buyers once confirmed, since PAID stops counting as reserved', async () => {
    // Stock 2: buyer A reserves 1 (PAYMENT_SUBMITTED), leaving 1 reservable. Confirming buyer A's
    // order cuts real stock to 1 and, because PAID falls outside StockReservationService's
    // reserving statuses, that same unit becomes checkout-able again for a second buyer — proving
    // the reservation was released rather than double-counted against the now-lower real stock.
    const app = getApp();
    const { seller, order, variant } = await orderPaymentSubmitted(app, 1, 2);
    await confirmPayment(seller, order.id);

    const buyerB = newClient(app);
    await registerVerified(app, buyerB, BUYER_B);
    const addressId = await createAddress(app, buyerB);
    await buyerB
      .post(`${API}/cart/items`)
      .set(CSRF_HEADER, await csrfToken(buyerB))
      .send({ variantId: variant.id, quantity: 1 });
    const response = await checkoutAsShown(buyerB, addressId);

    expect(response.status).toBe(201);
  });

  it('is idempotent — a second confirm is rejected and stock is not cut twice', async () => {
    const app = getApp();
    const { seller, order, variant } = await orderPaymentSubmitted(app, 1, 5);
    const first = await confirmPayment(seller, order.id);
    expect(first.status).toBe(200);

    const second = await confirmPayment(seller, order.id);

    expect(second.status).toBe(409);
    const variantRow = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantRow.stock).toBe(4); // cut once, not twice
  });

  it('refuses confirmation before a slip has been submitted (AWAITING_PAYMENT)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 'แบบเดียว', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);

    const response = await confirmPayment(seller, order.id);

    expect(response.status).toBe(409);
  });

  it('refuses confirmation for another shop’s order, or one that does not exist', async () => {
    const app = getApp();
    const { order } = await orderPaymentSubmitted(app);
    const superAdmin = app.client;
    const communityId = await createCommunity(superAdmin, 'ชุมชนอื่น');
    const { seller: otherSeller } = await sellerWithShop(app, OTHER_SELLER, communityId);

    const response = await confirmPayment(otherSeller, order.id);

    expect(response.status).toBe(404);
  });

  it('lets a suspended shop confirm payment normally — suspension blocks new sales, not finishing old ones (J2)', async () => {
    const app = getApp();
    const { seller, shopId, order } = await orderPaymentSubmitted(app);
    // The real suspension path (§82 — used to be a direct `suspendedAt` write). Suspending also
    // freezes the shop's open orders (invariant 7), which this action must survive too.
    const suspended = await app.client
      .post(`${API}/shops/${shopId}/suspend`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });
    expect(suspended.status).toBe(200);

    const response = await confirmPayment(seller, order.id);

    expect(response.status).toBe(200);
  });

  it('lets the shop confirm even while the order is frozen — invariant 7: locking this out would make I4’s "let it continue" meaningless', async () => {
    const app = getApp();
    const { seller, order } = await orderPaymentSubmitted(app);
    // A real freeze with the shop left alone (§82 — used to be a direct `frozenAt` write): a super
    // admin bans the buyer, which freezes the buyer's open orders (invariant 7, I10).
    const banned = await app.client
      .post(`${API}/admin/users/${order.buyerId}/ban`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ reason: 'เหตุผลสำหรับทดสอบการแบนผู้ซื้อ' });
    expect(banned.status).toBe(204);

    const response = await confirmPayment(seller, order.id);

    expect(response.status).toBe(200);
  });
});

describe('K8: insufficient stock rejects the whole confirmation — no partial confirm, no negative stock', () => {
  it('rejects with a message naming the short variant, and leaves the order at PAYMENT_SUBMITTED', async () => {
    const app = getApp();
    const { seller, order, product, variant } = await orderPaymentSubmitted(app, 2, 5);
    // The shop legitimately edits its own stock downward mid-flight (I13 — takes effect
    // immediately, no re-approval) to below what this order needs.
    await setVariantStock(seller, product.id, variant, 1);

    const response = await confirmPayment(seller, order.id);

    expect(response.status).toBe(409);
    expect((response.body as { message: string }).message).toContain(variant.name);
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('PAYMENT_SUBMITTED');
    const variantRow = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantRow.stock).toBe(1); // untouched, never goes negative
  });

  it('names every short item by product and option, not just the first one by option alone (§82)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    // Two products whose only option has the same name — the case the old message ("สินค้า
    // "สีแดง" ...") couldn't tell apart.
    const shirt = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายช้าง', 'สีแดง', 10000, 5);
    const bag = await approvedProduct(superAdmin, seller, categoryId, 'กระเป๋าผ้าทอมือ', 'สีแดง', 20000, 5);
    const hat = await approvedProduct(superAdmin, seller, categoryId, 'หมวกสานใบลาน', 'สีแดง', 15000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    for (const product of [shirt, bag, hat]) {
      await buyer
        .post(`${API}/cart/items`)
        .set(CSRF_HEADER, await csrfToken(buyer))
        .send({ variantId: product.variants[0]!.id, quantity: 2 });
    }
    const checkout = await checkoutAsShown(buyer, addressId);
    const order = (checkout.body as OrderBody[])[0]!;
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);
    await setVariantStock(seller, shirt.id, shirt.variants[0]!, 1);
    await setVariantStock(seller, bag.id, bag.variants[0]!, 1);

    const response = await confirmPayment(seller, order.id);

    expect(response.status).toBe(409);
    const message = (response.body as { message: string }).message;
    expect(message).toContain('เสื้อยืดลายช้าง — สีแดง');
    expect(message).toContain('กระเป๋าผ้าทอมือ — สีแดง');
    expect(message).not.toContain('หมวกสานใบลาน');
    // Rolled back whole: the hat had enough and its cut succeeded inside the transaction, but the
    // refusal undoes it — K8's "never half confirmed".
    const hatAfter = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: hat.variants[0]!.id } });
    expect(hatAfter.stock).toBe(5);
  });

  it('lets the shop retry successfully once stock is fixed', async () => {
    const app = getApp();
    const { seller, order, product, variant } = await orderPaymentSubmitted(app, 2, 5);
    await setVariantStock(seller, product.id, variant, 1);
    const rejected = await confirmPayment(seller, order.id);
    expect(rejected.status).toBe(409);

    await setVariantStock(seller, product.id, variant, 3);
    const response = await confirmPayment(seller, order.id);

    expect(response.status).toBe(200);
  });
});

describe('🚨 the real concurrent race this ticket is about: two orders confirming against the same short variant', () => {
  it('fires two real concurrent confirms for two different orders sharing one shrunk variant; exactly one succeeds', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของแย่งกัน', 'สีน้ำเงิน', 10000, 2);
    const variant = product.variants[0]!;

    const buyerA = newClient(app);
    await registerVerified(app, buyerA, BUYER);
    const orderA = await placeOrder(app, buyerA, variant.id, 1);
    await setShippingFee(seller, orderA.id, 2000);
    await uploadSlip(buyerA, orderA.id);

    const buyerB = newClient(app);
    await registerVerified(app, buyerB, BUYER_B);
    const orderB = await placeOrder(app, buyerB, variant.id, 1);
    await setShippingFee(seller, orderB.id, 2000);
    await uploadSlip(buyerB, orderB.id);

    // Both orders together reserved the full stock of 2 (1 each) — legitimate at checkout time.
    // The shop then shrinks stock to 1 (I13, immediate effect), so only one of the two pending
    // confirmations can actually be honoured. Fired with Promise.all — a sequential test would
    // pass even with a broken read-then-write race.
    await setVariantStock(seller, product.id, variant, 1);

    const [responseA, responseB] = await Promise.all([confirmPayment(seller, orderA.id), confirmPayment(seller, orderB.id)]);

    expect([responseA.status, responseB.status].sort()).toEqual([200, 409]);
    const variantRow = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantRow.stock).toBe(0); // cut exactly once, never negative
    const orders = await app.prisma.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } });
    expect(orders.filter((o) => o.status === 'PAID')).toHaveLength(1);
    expect(orders.filter((o) => o.status === 'PAYMENT_SUBMITTED')).toHaveLength(1);
  });
});
