import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown, shownCartLines } from './helpers/order.js';

/**
 * #49: checking out a cart splits it into one order per shop (invariant 4) and snapshots
 * everything invariant 5 says must never change afterward — price, product/variant name, and the
 * whole delivery address. `totalAmount` stays null (the shop hasn't quoted shipping yet, #51).
 * Stock reservation (#50), shipping (#51), cancellation (#52), and the sweep (#53) are not tested
 * here — out of this ticket's own scope.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';
const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'other-buyer@example.test';

interface OrderItemBody {
  id: string;
  variantId: string;
  productNameAtPurchase: string;
  variantNameAtPurchase: string;
  priceAtPurchase: number;
  quantity: number;
}
interface OrderBody {
  id: string;
  buyerId: string;
  shopId: string;
  status: string;
  displayStatus: string;
  totalAmountMinor: number | null;
  recipientName: string;
  phone: string;
  houseNumber: string;
  subdistrictName: string;
  districtName: string;
  provinceName: string;
  postalCode: string;
  items: OrderItemBody[];
}
interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
}
interface CartBody {
  items: { id: string; variantId: string; productId: string }[];
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

async function sellerWithShop(app: TestApp, email: string, communityId: string): Promise<{ client: Agent; shopId: string }> {
  const seller = newClient(app);
  await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return { client: seller, shopId };
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

async function createAddress(app: TestApp, client: Agent, overrides: Record<string, unknown> = {}): Promise<string> {
  const subdistrictPostalCodeId = await aRealSubdistrictPostalCodeId(app);
  const response = await client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({
      recipientName: 'สมชาย ใจดี',
      phone: '0812345678',
      houseNumber: '99/9',
      subdistrictPostalCodeId,
      ...overrides,
    });

  return (response.body as { id: string }).id;
}

async function addToCart(client: Agent, variantId: string, quantity = 1) {
  return client
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ variantId, quantity });
}

async function checkout(client: Agent, addressId: string) {
  return checkoutAsShown(client, addressId);
}

describe('checkout splits the cart into one order per shop (invariant 4, D1)', () => {
  it('creates one order for a single-shop cart with two items', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productA = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดตัวที่หนึ่ง', 15000, 10);
    const productB = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดตัวที่สอง', 18000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, productA.variants[0]!.id, 2);
    await addToCart(buyer, productB.variants[0]!.id, 1);

    const response = await checkout(buyer, addressId);

    expect(response.status).toBe(201);
    const orders = response.body as OrderBody[];
    expect(orders).toHaveLength(1);
    expect(orders[0]!.items).toHaveLength(2);
  });

  it('creates three orders for a three-shop cart, and items from the same shop combine into one', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: sellerA } = await sellerWithShop(app, 'seller-a@example.test', communityId);
    const { client: sellerB } = await sellerWithShop(app, 'seller-b@example.test', communityId);
    const { client: sellerC } = await sellerWithShop(app, 'seller-c@example.test', communityId);
    const productA1 = await approvedProduct(superAdmin, sellerA, categoryId, 'สินค้าร้านเอ หนึ่ง', 10000, 10);
    const productA2 = await approvedProduct(superAdmin, sellerA, categoryId, 'สินค้าร้านเอ สอง', 12000, 10);
    const productB = await approvedProduct(superAdmin, sellerB, categoryId, 'สินค้าร้านบี', 20000, 10);
    const productC = await approvedProduct(superAdmin, sellerC, categoryId, 'สินค้าร้านซี', 30000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, productA1.variants[0]!.id);
    await addToCart(buyer, productA2.variants[0]!.id);
    await addToCart(buyer, productB.variants[0]!.id);
    await addToCart(buyer, productC.variants[0]!.id);

    const response = await checkout(buyer, addressId);

    const orders = response.body as OrderBody[];
    expect(orders).toHaveLength(3);
    const shopWithTwoItems = orders.find((order) => order.items.length === 2);
    expect(shopWithTwoItems).toBeDefined();
  });

  it('removes only the ordered items from the cart, leaving the rest', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);

    await checkout(buyer, addressId);

    const cart = await buyer.get(`${API}/cart`);
    expect((cart.body as CartBody).items).toEqual([]);
  });
});

describe('a cart can only be checked out once (§81)', () => {
  it('two concurrent checkouts of the same cart create one set of orders — the other gets 409', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    // Plenty of stock on purpose: the bug this pins down was never about running out — the second
    // checkout passed the stock check fine and then ordered a cart that was already ordered.
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ผ้าขาวม้าทอมือ', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id, 1);
    const token = await csrfToken(buyer);
    const items = await shownCartLines(buyer);

    // A double-click: two real requests in flight at once, not one after the other — the same screen, so the same body.
    const responses = await Promise.all([
      buyer.post(`${API}/orders`).set(CSRF_HEADER, token).send({ addressId, items }),
      buyer.post(`${API}/orders`).set(CSRF_HEADER, token).send({ addressId, items }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const loser = responses.find((response) => response.status === 409)!;
    expect((loser.body as ErrorBody).code).toBe('CONFLICT');

    const orders = await buyer.get(`${API}/orders`);
    expect((orders.body as { items: OrderBody[] }).items).toHaveLength(1);
    expect(await app.prisma.stockReservation.count()).toBe(1);
  });

  it('refuses an order whose items alone exceed 20 million baht, before creating anything', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    // 21,000 บาท × 999 = 20,979,000 บาท — over the cap, and over what `total_amount_minor` could
    // ever hold once shipping is added, which used to surface as a 500 at shipping-fee time.
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ทองคำแท่งชุมชน', 2_100_000, 999);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id, 999);

    const response = await checkout(buyer, addressId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
    const orders = await buyer.get(`${API}/orders`);
    expect((orders.body as { items: OrderBody[] }).items).toEqual([]);
    // Nothing was claimed from the cart either — the buyer can lower the quantity and retry.
    const cart = await buyer.get(`${API}/cart`);
    expect((cart.body as CartBody).items).toHaveLength(1);
  });
});

describe('checkout needs a verified email — same gate as adding to the cart (K4)', () => {
  it('answers 403 EMAIL_NOT_VERIFIED for a signed-in buyer with no verified email', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await checkout(buyer, newId());

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('answers 401 for a signed-out caller', async () => {
    const response = await checkout(newClient(getApp()), newId());

    expect(response.status).toBe(401);
  });
});

describe('an empty cart, or one with nothing orderable, cannot be checked out', () => {
  it('answers 409 for an empty cart', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);

    const response = await checkout(buyer, addressId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('answers 409 when every item in the cart has become unorderable', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);
    await app.prisma.product.update({ where: { id: product.id }, data: { moderationStatus: 'REJECTED' } });

    const response = await checkout(buyer, addressId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('checks out only the orderable items, leaving the unorderable one behind in the cart', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const goodProduct = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดปกติ', 15000, 10);
    const badProduct = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดถูกตีตก', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, goodProduct.variants[0]!.id);
    await addToCart(buyer, badProduct.variants[0]!.id);
    await app.prisma.product.update({ where: { id: badProduct.id }, data: { moderationStatus: 'REJECTED' } });

    const response = await checkout(buyer, addressId);

    expect(response.status).toBe(201);
    const orders = response.body as OrderBody[];
    expect(orders).toHaveLength(1);
    expect(orders[0]!.items).toHaveLength(1);
    expect(orders[0]!.items[0]!.productNameAtPurchase).toBe('เสื้อยืดปกติ');

    const cart = await buyer.get(`${API}/cart`);
    const remaining = (cart.body as CartBody).items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.productId).toBe(badProduct.id);
  });
});

describe('invalid or foreign addressId', () => {
  it('answers 404 for an address that does not exist', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    await addToCart(buyer, product.variants[0]!.id);

    const response = await checkout(buyer, newId());

    expect(response.status).toBe(404);
  });

  it('answers 404 for another buyer’s address', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    await addToCart(buyer, product.variants[0]!.id);
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);
    const otherAddressId = await createAddress(app, otherBuyer);

    const response = await checkout(buyer, otherAddressId);

    expect(response.status).toBe(404);
  });
});

describe('⚠️ snapshot: an order never changes after it is placed (invariant 5, tests 18 · 19 of the spec)', () => {
  it('keeps the original price and product name after the shop edits both', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดชื่อเดิม', 15000, 10);
    const variantId = product.variants[0]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, variantId);
    const checkoutResponse = await checkout(buyer, addressId);
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;

    await seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'เสื้อยืดชื่อใหม่', description: 'คำอธิบายใหม่', categoryId });
    await seller
      .patch(`${API}/products/${product.id}/variants/${variantId}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'แบบเดียว', priceAmountMinor: 99900, stock: 10, expectedStock: 10 });

    const order = await buyer.get(`${API}/orders/${orderId}`);

    const item = (order.body as OrderBody).items[0]!;
    expect(item.productNameAtPurchase).toBe('เสื้อยืดชื่อเดิม');
    expect(item.priceAtPurchase).toBe(15000);
  });

  it('keeps the original delivery address after it is edited, and after it is deleted', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const subdistrictPostalCodeId = await aRealSubdistrictPostalCodeId(app);
    const addressId = await createAddress(app, buyer, { recipientName: 'สมชาย ใจดี', subdistrictPostalCodeId });
    await addToCart(buyer, product.variants[0]!.id);
    const checkoutResponse = await checkout(buyer, addressId);
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;

    await buyer
      .patch(`${API}/addresses/${addressId}`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .send({ recipientName: 'สมหญิง แก้วใส', phone: '0898765432', houseNumber: '1/1', subdistrictPostalCodeId });
    await buyer.delete(`${API}/addresses/${addressId}`).set(CSRF_HEADER, await csrfToken(buyer));

    const order = await buyer.get(`${API}/orders/${orderId}`);

    expect((order.body as OrderBody).recipientName).toBe('สมชาย ใจดี');
  });
});

describe('an order has no total amount until the shop quotes shipping (invariant 4, 🔒)', () => {
  it('answers null for totalAmountMinor on a freshly-created order', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);

    const response = await checkout(buyer, addressId);

    expect((response.body as OrderBody[])[0]!.totalAmountMinor).toBeNull();
  });
});

describe('status starts at AWAITING_SHIPPING_QUOTE, and displayStatus folds in frozenAt (I6)', () => {
  it('a fresh order’s status and displayStatus both read AWAITING_SHIPPING_QUOTE', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);

    const response = await checkout(buyer, addressId);

    const order = (response.body as OrderBody[])[0]!;
    expect(order.status).toBe('AWAITING_SHIPPING_QUOTE');
    expect(order.displayStatus).toBe('AWAITING_SHIPPING_QUOTE');
  });

  it('⚠️ displayStatus reads FROZEN once frozenAt is set, while status underneath is unchanged', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);
    const checkoutResponse = await checkout(buyer, addressId);
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;

    await app.prisma.order.update({ where: { id: orderId }, data: { frozenAt: app.clock.now() } });

    const order = await buyer.get(`${API}/orders/${orderId}`);

    const body = order.body as OrderBody;
    expect(body.displayStatus).toBe('FROZEN');
    expect(body.status).toBe('AWAITING_SHIPPING_QUOTE');
  });
});

describe('a buyer sees only their own orders; a shop sees only its own', () => {
  it('lists a buyer’s own orders on GET /orders', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);
    const checkoutResponse = await checkout(buyer, addressId);
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;

    const response = await buyer.get(`${API}/orders`);

    const body = response.body as { items: OrderBody[] };
    expect(body.items.map((order) => order.id)).toContain(orderId);
  });

  it('lists a shop’s own orders on GET /shops/me/orders', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);
    const checkoutResponse = await checkout(buyer, addressId);
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;

    const response = await seller.get(`${API}/shops/me/orders`);

    const body = response.body as { items: OrderBody[] };
    expect(body.items.map((order) => order.id)).toContain(orderId);
  });

  it('buyer ก. cannot see buyer ข.’s order — GET /orders/:id answers 404', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);
    const checkoutResponse = await checkout(buyer, addressId);
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);

    const response = await otherBuyer.get(`${API}/orders/${orderId}`);

    expect(response.status).toBe(404);
  });

  it('shop ก. cannot see shop ข.’s order', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: sellerA } = await sellerWithShop(app, SELLER, communityId);
    const { client: sellerB } = await sellerWithShop(app, OTHER_SELLER, communityId);
    const productA = await approvedProduct(superAdmin, sellerA, categoryId, 'สินค้าร้านเอ', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, productA.variants[0]!.id);
    const checkoutResponse = await checkout(buyer, addressId);
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;

    const response = await sellerB.get(`${API}/orders/${orderId}`);

    expect(response.status).toBe(404);
  });

  it('the shop owner (not just the buyer) can view the order detail', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const addressId = await createAddress(app, buyer);
    await addToCart(buyer, product.variants[0]!.id);
    const checkoutResponse = await checkout(buyer, addressId);
    const orderId = (checkoutResponse.body as OrderBody[])[0]!.id;

    const response = await seller.get(`${API}/orders/${orderId}`);

    expect(response.status).toBe(200);
  });
});
