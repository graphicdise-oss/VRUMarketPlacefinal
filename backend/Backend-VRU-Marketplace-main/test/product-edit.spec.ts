import type { Agent } from 'supertest';
import sharp from 'sharp';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #44: invariant 6's two-group edit split (A3/I13). Name/description/category/variant-name/a new
 * variant reset an already-approved product to PENDING, which hides it from the public list/page
 * through #42's own single visibility filter — never a manual unpublish call here. Stock/price/
 * deleting a variant take effect immediately with no re-review, even though a variant's name and
 * its price/stock sit on the exact same row (the point this ticket calls out as easiest to get
 * wrong in the whole project).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';

interface VariantBody {
  id: string;
  name: string;
  priceAmountMinor: number;
  stock: number;
}
interface ProductBody {
  id: string;
  moderationStatus: string;
  variants: VariantBody[];
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
  await approveShop(app, (applied.body as { id: string }).id);

  return seller;
}

/** An already-APPROVED, published product with one variant — the state every edit test starts from. */
async function approvedProduct(seller: Agent, superAdmin: Agent, categoryId: string): Promise<ProductBody> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name: 'เสื้อยืดลายชุมชน',
      description: 'เสื้อยืดผ้าคอตตอน 100% ผลิตในชุมชน',
      categoryId,
      variants: [{ name: 'สีแดง / ไซส์ M', priceAmountMinor: 15000, stock: 10 }],
    });
  const productId = (created.body as ProductBody).id;

  await approveProduct(superAdmin, productId);

  const fetched = await seller.get(`${API}/products/${productId}`);

  return fetched.body as ProductBody;
}

async function isPubliclyListed(app: TestApp, productId: string): Promise<boolean> {
  const response = await newClient(app).get(`${API}/products`);
  return (response.body as { items: { id: string }[] }).items.some((item) => item.id === productId);
}

describe('editing name/description/category resets to PENDING and hides the product (invariant 6, group 1)', () => {
  it('editing the name sends it back to PENDING and off the public list immediately', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    expect(await isPubliclyListed(app, product.id)).toBe(true);

    const response = await seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'เสื้อยืดลายใหม่', description: 'เสื้อยืดผ้าคอตตอน 100% ผลิตในชุมชน', categoryId });

    expect(response.status).toBe(200);
    expect((response.body as ProductBody).moderationStatus).toBe('PENDING');
    expect(await isPubliclyListed(app, product.id)).toBe(false);
  });

  it('editing the description or category also resets to PENDING', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const otherCategoryId = await createCategory(superAdmin, 'ของใช้ในบ้าน');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);

    const response = await seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'เสื้อยืดลายชุมชน', description: 'คำอธิบายใหม่ทั้งหมด', categoryId: otherCategoryId });

    expect(response.status).toBe(200);
    expect((response.body as ProductBody).moderationStatus).toBe('PENDING');
  });

  it('refuses a retired category, and refuses a suspended shop (J2 · #38, added to the existing list)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);

    await app.prisma.category.update({ where: { id: categoryId }, data: { isActive: false } });
    const retiredResult = await seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'ชื่อใหม่', description: 'คำอธิบายใหม่', categoryId });
    expect(retiredResult.status).toBe(404);

    await app.prisma.category.update({ where: { id: categoryId }, data: { isActive: true } });
    await suspendShop(app, (await app.prisma.shop.findFirstOrThrow({ where: { owner: { email: SELLER } } })).id);
    const suspendedResult = await seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'ชื่อใหม่', description: 'คำอธิบายใหม่', categoryId });
    expect(suspendedResult.status).toBe(403);
  });

  // Code review (2026-09-22, §78 — deferred from topic 4's §77): a closed shop could still add
  // and edit products before this fix, because requireShopMaySell only ever checked
  // approvalStatus/suspendedAt, never closedAt.
  it('refuses a closed shop both creating and editing a product', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);

    const shopId = (await app.prisma.shop.findFirstOrThrow({ where: { owner: { email: SELLER } } })).id;
    await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller)).expect(200);

    const editResult = await seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'ชื่อใหม่', description: 'คำอธิบายใหม่', categoryId });
    expect(editResult.status).toBe(403);

    const createResult = await seller
      .post(`${API}/products`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({
        name: 'สินค้าใหม่',
        description: 'คำอธิบาย',
        categoryId,
        variants: [{ name: 'แบบเดียว', priceAmountMinor: 1000, stock: 1 }],
      });
    expect(createResult.status).toBe(403);
  });

  it('refuses another seller’s product, and does not leak moderationStatus edits (whitelist rejects it)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const other = await sellerWithShop(app, OTHER_SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);

    const response = await other
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(other))
      .send({ name: 'ชื่อใหม่', description: 'คำอธิบายใหม่', categoryId });
    expect(response.status).toBe(404);

    const smuggled = await seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'ชื่อใหม่', description: 'คำอธิบายใหม่', categoryId, moderationStatus: 'APPROVED' });
    expect(smuggled.status).toBe(400);
  });
});

describe('⚠️ a variant’s name and its stock/price share a row but belong to different groups (I13, the easiest mistake)', () => {
  it('editing a variant’s price stays in the list, and the new price takes effect immediately', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const variant = product.variants[0]!;
    expect(await isPubliclyListed(app, product.id)).toBe(true);

    const response = await seller
      .patch(`${API}/products/${product.id}/variants/${variant.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: variant.name, priceAmountMinor: 19900, stock: variant.stock, expectedStock: variant.stock });

    expect(response.status).toBe(200);
    const body = response.body as ProductBody;
    expect(body.moderationStatus).toBe('APPROVED');
    expect(body.variants[0]!.priceAmountMinor).toBe(19900);
    expect(await isPubliclyListed(app, product.id)).toBe(true);

    const publicView = await newClient(app).get(`${API}/products/${product.id}`);
    expect((publicView.body as { variants: VariantBody[] }).variants[0]!.priceAmountMinor).toBe(19900);
  });

  it('editing a variant’s stock also stays APPROVED, with no re-review', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const variant = product.variants[0]!;

    const response = await seller
      .patch(`${API}/products/${product.id}/variants/${variant.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: variant.name, priceAmountMinor: variant.priceAmountMinor, stock: 3, expectedStock: variant.stock });

    expect(response.status).toBe(200);
    const body = response.body as ProductBody;
    expect(body.moderationStatus).toBe('APPROVED');
    expect(body.variants[0]!.stock).toBe(3);
  });

  it('⚠️ editing a variant’s name — the same row as price/stock — resets the whole product to PENDING', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const variant = product.variants[0]!;

    const response = await seller
      .patch(`${API}/products/${product.id}/variants/${variant.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'สีน้ำเงิน / ไซส์ L', priceAmountMinor: variant.priceAmountMinor, stock: variant.stock, expectedStock: variant.stock });

    expect(response.status).toBe(200);
    expect((response.body as ProductBody).moderationStatus).toBe('PENDING');
    expect(await isPubliclyListed(app, product.id)).toBe(false);
  });

  it('a request that changes both the name and the price still resets — the name change dominates', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const variant = product.variants[0]!;

    const response = await seller
      .patch(`${API}/products/${product.id}/variants/${variant.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'สีเขียว', priceAmountMinor: 20000, stock: variant.stock, expectedStock: variant.stock });

    expect(response.status).toBe(200);
    const body = response.body as ProductBody;
    expect(body.moderationStatus).toBe('PENDING');
    expect(body.variants[0]!.priceAmountMinor).toBe(20000);
  });
});

describe('adding a new variant always resets to PENDING (invariant 6, group 1)', () => {
  it('a new variant sends the whole product back to PENDING', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);

    const response = await seller
      .post(`${API}/products/${product.id}/variants`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'สีดำ / ไซส์ L', priceAmountMinor: 16000, stock: 5 });

    expect(response.status).toBe(201);
    const body = response.body as ProductBody;
    expect(body.moderationStatus).toBe('PENDING');
    expect(body.variants).toHaveLength(2);
    expect(await isPubliclyListed(app, product.id)).toBe(false);
  });
});

describe('deleting a variant never resets to PENDING (invariant 6, group 2) and is a soft delete (L6)', () => {
  it('deleting one of two variants stays APPROVED and the deleted variant stops appearing', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const added = await seller
      .post(`${API}/products/${product.id}/variants`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'สีดำ / ไซส์ L', priceAmountMinor: 16000, stock: 5 });
    await approveProduct(superAdmin, product.id);
    const secondVariantId = (added.body as ProductBody).variants[1]!.id;

    const response = await seller
      .delete(`${API}/products/${product.id}/variants/${secondVariantId}`)
      .set(CSRF_HEADER, await csrfToken(seller));

    expect(response.status).toBe(200);
    const body = response.body as ProductBody;
    expect(body.moderationStatus).toBe('APPROVED');
    expect(body.variants).toHaveLength(1);
    expect(await isPubliclyListed(app, product.id)).toBe(true);

    const deletedRow = await app.prisma.productVariant.findUnique({
      where: { id: secondVariantId },
      select: { deletedAt: true },
    });
    expect(deletedRow?.deletedAt).not.toBeNull();
  });

  it('⚠️ refuses to delete a product’s last live variant — a product with none would have no price or stock to show', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const variant = product.variants[0]!;

    const response = await seller
      .delete(`${API}/products/${product.id}/variants/${variant.id}`)
      .set(CSRF_HEADER, await csrfToken(seller));

    expect(response.status).toBe(409);
    await expect(
      app.prisma.productVariant.findUnique({ where: { id: variant.id }, select: { deletedAt: true } }),
    ).resolves.toMatchObject({ deletedAt: null });
  });
});

describe('adding or removing a photo resets to PENDING too (invariant 6, group 1 — #44 extends #41’s addImage/removeImage)', () => {
  it('adding a photo to an approved product resets it to PENDING', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const response = await seller
      .post(`${API}/products/${product.id}/images`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', jpeg, 'photo.jpg');

    expect(response.status).toBe(200);
    expect((response.body as ProductBody).moderationStatus).toBe('PENDING');
    expect(await isPubliclyListed(app, product.id)).toBe(false);
  });

  it('removing a photo from an approved product also resets it to PENDING', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const withImage = await seller
      .post(`${API}/products/${product.id}/images`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', jpeg, 'photo.jpg');
    const imageId = (withImage.body as { images: { id: string }[] }).images[0]!.id;
    await approveProduct(superAdmin, product.id);

    const response = await seller
      .delete(`${API}/products/${product.id}/images/${imageId}`)
      .set(CSRF_HEADER, await csrfToken(seller));

    expect(response.status).toBe(200);
    expect((response.body as ProductBody).moderationStatus).toBe('PENDING');
  });
});

describe('DELETE /products/:productId — whole-product soft delete (§78, L6)', () => {
  it('disappears from the public list and from GET /products/mine, but the row and its variants stay', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    const variantId = product.variants[0]!.id;
    expect(await isPubliclyListed(app, product.id)).toBe(true);

    const response = await seller
      .delete(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller));

    expect(response.status).toBe(204);
    expect(await isPubliclyListed(app, product.id)).toBe(false);

    const mine = await seller.get(`${API}/products/mine`);
    expect((mine.body as { items: { id: string }[] }).items.some((item) => item.id === product.id)).toBe(false);

    const row = await app.prisma.product.findUnique({ where: { id: product.id }, select: { deletedAt: true } });
    expect(row?.deletedAt).not.toBeNull();
    const variantRow = await app.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { deletedAt: true },
    });
    expect(variantRow?.deletedAt).not.toBeNull();
  });

  it('refuses another seller’s product, and refuses a suspended shop’s own product', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const other = await sellerWithShop(app, OTHER_SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);

    const stolen = await other.delete(`${API}/products/${product.id}`).set(CSRF_HEADER, await csrfToken(other));
    expect(stolen.status).toBe(404);

    await suspendShop(app, (await app.prisma.shop.findFirstOrThrow({ where: { owner: { email: SELLER } } })).id);
    const suspended = await seller.delete(`${API}/products/${product.id}`).set(CSRF_HEADER, await csrfToken(seller));
    expect(suspended.status).toBe(403);
  });

  it('answers 404 deleting a product that no longer exists (already deleted)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(seller, superAdmin, categoryId);
    await seller.delete(`${API}/products/${product.id}`).set(CSRF_HEADER, await csrfToken(seller));

    const again = await seller.delete(`${API}/products/${product.id}`).set(CSRF_HEADER, await csrfToken(seller));

    expect(again.status).toBe(404);
  });
});
