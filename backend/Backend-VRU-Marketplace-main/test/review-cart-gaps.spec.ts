import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { checkoutAsShown } from './helpers/order.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §111 — the gaps a scrutiny of reviews and the cart found, each settled by the owner:
 * a shop owner buying from (and so reviewing) their own shop; the cart showing a product's
 * unreviewed new name; the cart never saying a price changed and checkout charging a price the
 * buyer never saw; no cap on cart lines; a review photo that can be added but never removed; and
 * a review's author never told an admin removed it.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'other-buyer@example.test';

interface VariantBody {
  id: string;
  name: string;
  priceAmountMinor: number;
  stock: number;
}
interface ProductBody {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  variants: VariantBody[];
}
interface CartItemBody {
  id: string;
  variantId: string;
  quantity: number;
  productName: string;
  variantName: string;
  priceAmountMinor: number;
  priceAmountMinorWhenAdded: number;
  orderable: boolean;
  unavailableReason: string | null;
}
interface CartBody {
  items: CartItemBody[];
  orderCount: number;
}
interface OrderBody {
  id: string;
  status: string;
}
interface ReviewBody {
  id: string;
  text: string | null;
  images: { id: string }[];
}
interface NotificationBody {
  type: string;
  message: string;
  targetType: string | null;
  targetId: string | null;
}

interface World {
  superAdmin: Agent;
  seller: Agent;
  shopId: string;
  categoryId: string;
  buyer: Agent;
}

async function world(app: TestApp): Promise<World> {
  const superAdmin = app.client;
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  const community = await superAdmin
    .post(`${API}/communities`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' });
  const category = await superAdmin
    .post(`${API}/categories`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name: 'เสื้อผ้า' });
  const seller = newClient(app);
  await registerVerified(app, seller, SELLER);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId: (community.body as { id: string }).id, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);

  return { superAdmin, seller, shopId, categoryId: (category.body as { id: string }).id, buyer };
}

async function createProduct(w: World, name: string, variants: { name: string; priceAmountMinor: number; stock: number }[]): Promise<ProductBody> {
  const created = await w.seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(w.seller))
    .send({ name, description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId: w.categoryId, variants });

  return created.body as ProductBody;
}

async function approvedProduct(w: World, name: string, variants = [{ name: 'สีแดง', priceAmountMinor: 10000, stock: 5 }]): Promise<ProductBody> {
  const product = await createProduct(w, name, variants);
  await approveProduct(w.superAdmin, product.id);
  const fetched = await w.seller.get(`${API}/products/${product.id}`);

  return fetched.body as ProductBody;
}

async function addToCart(client: Agent, variantId: string, quantity = 1) {
  return client
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ variantId, quantity });
}

async function cartOf(client: Agent): Promise<CartBody> {
  return (await client.get(`${API}/cart`)).body as CartBody;
}

async function setQuantity(client: Agent, cartItemId: string, quantity: number) {
  return client
    .patch(`${API}/cart/items/${cartItemId}`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ quantity });
}

async function editVariant(w: World, product: ProductBody, variant: VariantBody, change: Partial<Pick<VariantBody, 'name' | 'priceAmountMinor'>>) {
  return w.seller
    .patch(`${API}/products/${product.id}/variants/${variant.id}`)
    .set(CSRF_HEADER, await csrfToken(w.seller))
    .send({ name: variant.name, priceAmountMinor: variant.priceAmountMinor, stock: variant.stock, expectedStock: variant.stock, ...change });
}

async function createAddress(app: TestApp, client: Agent): Promise<string> {
  const subdistrict = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  const response = await client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId: subdistrict.id });

  return (response.body as { id: string }).id;
}

async function placeOrderShowing(client: Agent, addressId: string, items: { cartItemId: string; quantity: number; priceAmountMinor: number }[]) {
  return client
    .post(`${API}/orders`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ addressId, items });
}

async function aJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

/** Placed, paid, shipped and received — ready to review. */
async function completedOrder(app: TestApp, w: World): Promise<OrderBody> {
  const carrier = await w.superAdmin
    .post(`${API}/shipping-carriers`)
    .set(CSRF_HEADER, await csrfToken(w.superAdmin))
    .send({ name: 'Kerry' });
  const product = await approvedProduct(w, 'ของทดสอบรีวิว');
  await addToCart(w.buyer, product.variants[0]!.id);
  const placed = await checkoutAsShown(w.buyer, await createAddress(app, w.buyer));
  const order = (placed.body as OrderBody[])[0]!;
  await w.seller
    .post(`${API}/shops/me/orders/${order.id}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(w.seller))
    .send({ shippingAmountMinor: 2000 });
  await w.buyer
    .post(`${API}/orders/${order.id}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(w.buyer))
    .attach('file', await aJpeg(), 'slip.jpg');
  await w.seller.post(`${API}/shops/me/orders/${order.id}/confirm-payment`).set(CSRF_HEADER, await csrfToken(w.seller));
  await w.seller
    .post(`${API}/shops/me/orders/${order.id}/ship`)
    .set(CSRF_HEADER, await csrfToken(w.seller))
    .send({ shippingCarrierId: (carrier.body as { id: string }).id, trackingNumber: 'TH1234567890' });
  const received = await w.buyer.post(`${API}/orders/${order.id}/receive`).set(CSRF_HEADER, await csrfToken(w.buyer));

  return received.body as OrderBody;
}

async function writeReview(buyer: Agent, orderId: string, body: { rating: number; text?: string }) {
  return buyer
    .post(`${API}/orders/${orderId}/review`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send(body);
}

async function addReviewPhoto(buyer: Agent, orderId: string) {
  return buyer
    .post(`${API}/orders/${orderId}/review/images`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpeg(), 'photo.jpg');
}

async function removeReviewPhoto(client: Agent, orderId: string, imageId: string) {
  return client.delete(`${API}/orders/${orderId}/review/images/${imageId}`).set(CSRF_HEADER, await csrfToken(client));
}

describe('a shop owner cannot buy from their own shop (§111)', () => {
  it('refuses adding the own shop’s product to the cart, so no self-order and no self-review can follow', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด');

    const added = await addToCart(w.seller, product.variants[0]!.id);

    expect(added.status).toBe(403);
    expect((added.body as ErrorBody).code).toBe('FORBIDDEN');
    expect((await cartOf(w.seller)).items).toHaveLength(0);
  });
});

describe('the cart never shows text moderation has not passed (§111)', () => {
  it('shows the names from when the item was added once the shop renames the product and the option', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด');
    const variant = product.variants[0]!;
    await addToCart(w.buyer, variant.id);

    await w.seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(w.seller))
      .send({ name: 'ข้อความต้องห้าม', description: product.description, categoryId: product.categoryId });
    await editVariant(w, product, variant, { name: 'ตัวเลือกต้องห้าม' });

    const line = (await cartOf(w.buyer)).items[0]!;
    expect(line.orderable).toBe(false);
    expect(line.unavailableReason).toBe('PRODUCT_UNAVAILABLE');
    expect(line.productName).toBe('เสื้อยืด');
    expect(line.variantName).toBe('สีแดง');
  });

  it('refuses adding a product that has never been approved', async () => {
    const app = getApp();
    const w = await world(app);
    const pending = await createProduct(w, 'ยังไม่ผ่านการตรวจ', [{ name: 'แบบเดียว', priceAmountMinor: 100, stock: 1 }]);

    const added = await addToCart(w.buyer, pending.variants[0]!.id);

    expect(added.status).toBe(409);
    expect(JSON.stringify(added.body)).not.toContain('ยังไม่ผ่านการตรวจ');
    expect((await cartOf(w.buyer)).items).toHaveLength(0);
  });

  it('refuses adding a product of a suspended shop', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด');
    await suspendShop(app, w.shopId);

    const added = await addToCart(w.buyer, product.variants[0]!.id);

    expect(added.status).toBe(409);
  });

  it('says why a line cannot be ordered: shop, product or deleted option', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด', [
      { name: 'ไซส์ M', priceAmountMinor: 10000, stock: 5 },
      { name: 'ไซส์ L', priceAmountMinor: 10000, stock: 5 },
    ]);
    await addToCart(w.buyer, product.variants[0]!.id);
    await addToCart(w.buyer, product.variants[1]!.id);
    expect((await cartOf(w.buyer)).items.map((line) => line.unavailableReason)).toEqual([null, null]);

    await w.seller.delete(`${API}/products/${product.id}/variants/${product.variants[1]!.id}`).set(CSRF_HEADER, await csrfToken(w.seller));
    await suspendShop(app, w.shopId);

    const reasons = (await cartOf(w.buyer)).items.map((line) => line.unavailableReason);
    expect(reasons).toEqual(['SHOP_UNAVAILABLE', 'VARIANT_DELETED']);
  });

  it('refuses changing the quantity of a line that can no longer be ordered — it can only be removed', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด');
    await addToCart(w.buyer, product.variants[0]!.id);
    await suspendShop(app, w.shopId);
    const line = (await cartOf(w.buyer)).items[0]!;

    const changed = await setQuantity(w.buyer, line.id, 3);

    expect(changed.status).toBe(409);
    expect((await cartOf(w.buyer)).items[0]!.quantity).toBe(1);
  });
});

describe('a price change is visible in the cart and never charged unseen (§111, K4)', () => {
  it('keeps the price from when the item was added next to the live one', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด');
    const variant = product.variants[0]!;
    await addToCart(w.buyer, variant.id);

    await editVariant(w, product, variant, { priceAmountMinor: 15000 });

    const line = (await cartOf(w.buyer)).items[0]!;
    expect(line.priceAmountMinor).toBe(15000);
    expect(line.priceAmountMinorWhenAdded).toBe(10000);
    expect(line.orderable).toBe(true);
  });

  it('takes changing the quantity or adding again as seeing the new price', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด');
    const variant = product.variants[0]!;
    await addToCart(w.buyer, variant.id);
    await editVariant(w, product, variant, { priceAmountMinor: 15000 });

    await setQuantity(w.buyer, (await cartOf(w.buyer)).items[0]!.id, 2);
    expect((await cartOf(w.buyer)).items[0]!.priceAmountMinorWhenAdded).toBe(15000);

    await editVariant(w, product, { ...variant, priceAmountMinor: 15000 }, { priceAmountMinor: 12000 });
    await addToCart(w.buyer, variant.id);
    expect((await cartOf(w.buyer)).items[0]!.priceAmountMinorWhenAdded).toBe(12000);
  });

  it('refuses checkout with STALE_VIEW when the shop changed the price after the buyer’s screen loaded', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด');
    const variant = product.variants[0]!;
    await addToCart(w.buyer, variant.id);
    const addressId = await createAddress(app, w.buyer);
    const shown = (await cartOf(w.buyer)).items[0]!;

    await editVariant(w, product, variant, { priceAmountMinor: 99000 });
    const placed = await placeOrderShowing(w.buyer, addressId, [{ cartItemId: shown.id, quantity: shown.quantity, priceAmountMinor: shown.priceAmountMinor }]);

    expect(placed.status).toBe(409);
    expect((placed.body as ErrorBody).code).toBe('STALE_VIEW');
    expect((await w.buyer.get(`${API}/orders`)).body).toMatchObject({ items: [] });
    expect((await cartOf(w.buyer)).items).toHaveLength(1);
  });

  it('refuses checkout when the quantity shown is not the cart’s, a shown line is missing, or one is sent twice', async () => {
    const app = getApp();
    const w = await world(app);
    const first = await approvedProduct(w, 'เสื้อยืด');
    const second = await approvedProduct(w, 'กางเกง');
    await addToCart(w.buyer, first.variants[0]!.id);
    await addToCart(w.buyer, second.variants[0]!.id);
    const addressId = await createAddress(app, w.buyer);
    const [a, b] = (await cartOf(w.buyer)).items;

    const wrongQuantity = await placeOrderShowing(w.buyer, addressId, [
      { cartItemId: a!.id, quantity: 2, priceAmountMinor: a!.priceAmountMinor },
      { cartItemId: b!.id, quantity: b!.quantity, priceAmountMinor: b!.priceAmountMinor },
    ]);
    const missingLine = await placeOrderShowing(w.buyer, addressId, [{ cartItemId: a!.id, quantity: a!.quantity, priceAmountMinor: a!.priceAmountMinor }]);

    const duplicated = await placeOrderShowing(w.buyer, addressId, [
      { cartItemId: a!.id, quantity: a!.quantity, priceAmountMinor: a!.priceAmountMinor },
      { cartItemId: a!.id, quantity: a!.quantity, priceAmountMinor: a!.priceAmountMinor },
    ]);

    expect((wrongQuantity.body as ErrorBody).code).toBe('STALE_VIEW');
    expect((missingLine.body as ErrorBody).code).toBe('STALE_VIEW');
    expect((duplicated.body as ErrorBody).code).toBe('STALE_VIEW');
  });

  it('places the order when what was shown is what the cart holds', async () => {
    const app = getApp();
    const w = await world(app);
    const product = await approvedProduct(w, 'เสื้อยืด');
    await addToCart(w.buyer, product.variants[0]!.id, 2);

    const placed = await checkoutAsShown(w.buyer, await createAddress(app, w.buyer));

    expect(placed.status).toBe(201);
    expect(placed.body as OrderBody[]).toHaveLength(1);
  });
});

describe('a cart holds at most 100 lines (§111)', () => {
  it('refuses the 101st distinct line but still lets an existing line grow', async () => {
    const app = getApp();
    const w = await world(app);
    const variants = [];
    for (let p = 0; p < 3; p += 1) {
      const product = await approvedProduct(
        w,
        `สินค้าชุดที่ ${p + 1}`,
        Array.from({ length: p < 2 ? 50 : 1 }, (_, i) => ({ name: `ตัวเลือก ${i + 1}`, priceAmountMinor: 100, stock: 5 })),
      );
      variants.push(...product.variants);
    }
    for (const variant of variants.slice(0, 100)) {
      expect((await addToCart(w.buyer, variant.id)).status).toBe(200);
    }

    const extra = await addToCart(w.buyer, variants[100]!.id);
    const again = await addToCart(w.buyer, variants[0]!.id);

    expect(extra.status).toBe(409);
    expect(again.status).toBe(200);
    expect((await cartOf(w.buyer)).items).toHaveLength(100);
  });
});

describe('review photos and removal (§111)', () => {
  it('lets the buyer remove their own review photo within the edit window, and the photo stops being served', async () => {
    const app = getApp();
    const w = await world(app);
    const order = await completedOrder(app, w);
    const review = (await writeReview(w.buyer, order.id, { rating: 4 })).body as ReviewBody;
    const withPhoto = (await addReviewPhoto(w.buyer, order.id)).body as ReviewBody;
    const imageId = withPhoto.images[0]!.id;

    const removed = await removeReviewPhoto(w.buyer, order.id, imageId);

    expect(removed.status).toBe(200);
    expect((removed.body as ReviewBody).images).toEqual([]);
    expect((await app.client.get(`${API}/reviews/${review.id}/images/${imageId}`)).status).toBe(404);
    expect(await app.prisma.uploadedFile.count()).toBe(1); // only the payment slip is left
  });

  it('refuses removing a photo after the edit window, or from someone else’s review', async () => {
    const app = getApp();
    const w = await world(app);
    const order = await completedOrder(app, w);
    await writeReview(w.buyer, order.id, { rating: 4 });
    const imageId = ((await addReviewPhoto(w.buyer, order.id)).body as ReviewBody).images[0]!.id;
    const stranger = newClient(app);
    await registerVerified(app, stranger, OTHER_BUYER);

    expect((await removeReviewPhoto(stranger, order.id, imageId)).status).toBe(404);
    app.clock.advanceByDays(8);
    // Access tokens are short-lived — log back in before the next HTTP call (HANDOFF.md caveat).
    await registerAndLogin(w.buyer, BUYER);
    expect((await removeReviewPhoto(w.buyer, order.id, imageId)).status).toBe(409);
  });

  it('tells the review’s author, with the reason, when an admin removes it', async () => {
    const app = getApp();
    const w = await world(app);
    const order = await completedOrder(app, w);
    const review = (await writeReview(w.buyer, order.id, { rating: 1, text: 'ข้อความพาดพิงบุคคลอื่น' })).body as ReviewBody;

    await w.superAdmin
      .delete(`${API}/reviews/${review.id}`)
      .set(CSRF_HEADER, await csrfToken(w.superAdmin))
      .send({ reason: 'พาดพิงบุคคลอื่นโดยไม่เกี่ยวกับการซื้อขาย' });

    const notices = ((await w.buyer.get(`${API}/notifications`)).body as { items: NotificationBody[] }).items;
    const notice = notices.find((n) => n.type === 'REVIEW_REMOVED');
    expect(notice).toBeDefined();
    expect(notice!.message).toContain('พาดพิงบุคคลอื่นโดยไม่เกี่ยวกับการซื้อขาย');
    expect(notice!.targetType).toBe('ORDER');
    expect(notice!.targetId).toBe(order.id);
  });

  it('stores whitespace-only review text as no text', async () => {
    const app = getApp();
    const w = await world(app);
    const order = await completedOrder(app, w);

    const written = await writeReview(w.buyer, order.id, { rating: 3, text: '    ' });

    expect((written.body as ReviewBody).text).toBeNull();
  });
});
