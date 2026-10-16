import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #48 (K4): one server-side cart per person. No cart for a signed-out visitor and therefore no
 * merge-on-login logic (there is nothing to merge) — every route here needs a session, and adding
 * an item needs a verified email as well, through the one gate `@RequiresVerifiedEmail()` already
 * gives topic 4 (#34). Prices and stock are never frozen; that starts at the order (#49), not
 * here.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';
const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'other-buyer@example.test';

interface CartItemBody {
  id: string;
  variantId: string;
  quantity: number;
  productId: string;
  shopId: string;
  priceAmountMinor: number;
  stock: number;
  orderable: boolean;
}
interface CartBody {
  items: CartItemBody[];
  orderCount: number;
}
interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
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

/** An approved, published product with one variant, priced and stocked as given. */
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

async function addToCart(client: Agent, variantId: string, quantity = 1) {
  return client
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ variantId, quantity });
}

async function getCart(client: Agent) {
  return client.get(`${API}/cart`);
}

describe('adding to the cart needs a session and a verified email (K4)', () => {
  it('answers 401 for a signed-out caller', async () => {
    const response = await addToCart(newClient(getApp()), newId());

    expect(response.status).toBe(401);
  });

  it('answers 403 EMAIL_NOT_VERIFIED for a signed-in caller with no verified email — distinct from 401', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await addToCart(buyer, newId());

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('answers 404 for a variant that does not exist', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);

    const response = await addToCart(buyer, newId());

    expect(response.status).toBe(404);
  });
});

describe('the cart never freezes a price (K4)', () => {
  it('shows the current price, and the price updates live after the shop changes it', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const variantId = product.variants[0]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);

    await addToCart(buyer, variantId, 2);
    const before = await getCart(buyer);
    expect((before.body as CartBody).items[0]!.priceAmountMinor).toBe(15000);

    await seller
      .patch(`${API}/products/${product.id}/variants/${variantId}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'แบบเดียว', priceAmountMinor: 19900, stock: 10, expectedStock: 10 });

    const after = await getCart(buyer);
    expect((after.body as CartBody).items[0]!.priceAmountMinor).toBe(19900);
  });
});

describe('adding an already-cart-ed variant increases its quantity, not a second row', () => {
  it('does not duplicate the row when the same variant is added twice', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const variantId = product.variants[0]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);

    await addToCart(buyer, variantId, 2);
    const response = await addToCart(buyer, variantId, 3);

    const body = response.body as CartBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.quantity).toBe(5);
  });

  it('refuses an add that would push the line past 999, the same cap PATCH enforces (§81)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ข้าวหอมมะลิถุงเล็ก', 5000, 10);
    const variantId = product.variants[0]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    await addToCart(buyer, variantId, 999);

    const response = await addToCart(buyer, variantId, 1);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_FAILED');
    expect((response.body as ErrorBody).fieldErrors?.quantity).toBeDefined();
    const cart = await getCart(buyer);
    expect((cart.body as CartBody).items[0]!.quantity).toBe(999);
  });
});

describe('items from several shops sit in one cart, and orderCount tells the buyer how many orders checkout will make', () => {
  it('counts one order per distinct shop among items added', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: sellerA } = await sellerWithShop(app, SELLER, communityId);
    const { client: sellerB } = await sellerWithShop(app, OTHER_SELLER, communityId);
    const productA = await approvedProduct(superAdmin, sellerA, categoryId, 'เสื้อยืดร้านเอ', 10000, 5);
    const productB = await approvedProduct(superAdmin, sellerB, categoryId, 'เสื้อยืดร้านบี', 20000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);

    await addToCart(buyer, productA.variants[0]!.id);
    const response = await addToCart(buyer, productB.variants[0]!.id);

    const body = response.body as CartBody;
    expect(body.items).toHaveLength(2);
    expect(body.orderCount).toBe(2);
  });
});

describe('the cart never checks stock — that happens at order time (#50), not here', () => {
  it('lets a quantity exceed the variant’s current stock', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดของหายาก', 15000, 1);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);

    const response = await addToCart(buyer, product.variants[0]!.id, 50);

    expect(response.status).toBe(200);
    expect((response.body as CartBody).items[0]!.quantity).toBe(50);
  });
});

describe('updating quantity, removing an item, and clearing the cart', () => {
  it('sets the quantity outright, rather than adding to it', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const added = await addToCart(buyer, product.variants[0]!.id, 3);
    const cartItemId = (added.body as CartBody).items[0]!.id;

    const response = await buyer
      .patch(`${API}/cart/items/${cartItemId}`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .send({ quantity: 7 });

    expect((response.body as CartBody).items[0]!.quantity).toBe(7);
  });

  it('removes one item, leaving the rest', async () => {
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
    await addToCart(buyer, productA.variants[0]!.id);
    const added = await addToCart(buyer, productB.variants[0]!.id);
    const removeId = (added.body as CartBody).items.find((item) => item.productId === productB.id)!.id;

    const response = await buyer.delete(`${API}/cart/items/${removeId}`).set(CSRF_HEADER, await csrfToken(buyer));

    const body = response.body as CartBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.productId).toBe(productA.id);
  });

  it('empties the whole cart', async () => {
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

    const response = await buyer.delete(`${API}/cart`).set(CSRF_HEADER, await csrfToken(buyer));

    expect((response.body as CartBody).items).toEqual([]);
  });

  it('answers an empty cart, not an error, for someone who has never added anything', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);

    const response = await getCart(buyer);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], orderCount: 0 });
  });
});

describe('buyer ก. cannot read or change buyer ข.’s cart', () => {
  it('answers 404 updating or removing a cart item that belongs to someone else', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const added = await addToCart(buyer, product.variants[0]!.id);
    const cartItemId = (added.body as CartBody).items[0]!.id;

    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);

    const updateResult = await otherBuyer
      .patch(`${API}/cart/items/${cartItemId}`)
      .set(CSRF_HEADER, await csrfToken(otherBuyer))
      .send({ quantity: 2 });
    expect(updateResult.status).toBe(404);

    const removeResult = await otherBuyer
      .delete(`${API}/cart/items/${cartItemId}`)
      .set(CSRF_HEADER, await csrfToken(otherBuyer));
    expect(removeResult.status).toBe(404);

    const stillThere = await getCart(buyer);
    expect((stillThere.body as CartBody).items).toHaveLength(1);
  });
});

describe('an item that stops passing invariant 6’s visibility (#42) stays in the cart but is not orderable', () => {
  it('marks an item unorderable once its product is rejected, without removing it', async () => {
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

    await app.prisma.product.update({ where: { id: product.id }, data: { moderationStatus: 'REJECTED' } });

    const response = await getCart(buyer);

    const body = response.body as CartBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.orderable).toBe(false);
    expect(body.orderCount).toBe(0);
  });

  it('marks an item unorderable once the shop is suspended', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'เสื้อยืดลายชุมชน', 15000, 10);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    await addToCart(buyer, product.variants[0]!.id);

    await suspendShop(app, shopId);

    const response = await getCart(buyer);

    expect((response.body as CartBody).items[0]!.orderable).toBe(false);
  });

  it('marks an item unorderable once its variant is soft-deleted', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const created = await seller
      .post(`${API}/products`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({
        name: 'เสื้อยืดสองตัวเลือก',
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
    const variantId = (fetched.body as ProductBody).variants[1]!.id;
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    await addToCart(buyer, variantId);

    await seller.delete(`${API}/products/${productId}/variants/${variantId}`).set(CSRF_HEADER, await csrfToken(seller));

    const response = await getCart(buyer);

    expect((response.body as CartBody).items[0]!.orderable).toBe(false);
  });
});
