import type { Agent } from 'supertest';
import sharp from 'sharp';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #41: a shop owner listing a product with variants (C1: stock and price live on the variant,
 * never on the product) and attaching photos to it through #36's shared file-storage helper.
 * Editing (#44), approval (#43), and the public list/detail view (#42) are each their own
 * ticket and are not tested here.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';

interface VariantBody {
  id: string;
  name: string;
  priceAmountMinor: number;
  currency: string;
  stock: number;
}
interface ImageBody {
  id: string;
}
interface ProductBody {
  id: string;
  shopId: string;
  moderationStatus: string;
  variants: VariantBody[];
  images: ImageBody[];
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

/** A seller with an APPROVED, non-suspended shop — every product route needs one. */
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

function validVariant(overrides: Record<string, unknown> = {}) {
  return { name: 'สีแดง / ไซส์ M', priceAmountMinor: 15000, stock: 10, ...overrides };
}

function validPayload(categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'เสื้อยืดลายชุมชน',
    description: 'เสื้อยืดผ้าคอตตอน 100% ผลิตในชุมชน',
    categoryId,
    variants: [validVariant()],
    ...overrides,
  };
}

async function create(client: Agent, payload: Record<string, unknown>) {
  return client
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send(payload);
}

async function addImage(client: Agent, productId: string, buffer: Buffer, filename = 'photo.jpg') {
  return client
    .post(`${API}/products/${productId}/images`)
    .set(CSRF_HEADER, await csrfToken(client))
    .attach('file', buffer, filename);
}

async function removeImage(client: Agent, productId: string, imageId: string) {
  return client
    .delete(`${API}/products/${productId}/images/${imageId}`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send();
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 200, b: 10 } } })
    .jpeg()
    .toBuffer();
}

describe('listing a product (#41 · C1)', () => {
  it('requires a session', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const response = await newClient(app).post(`${API}/products`).send(validPayload(categoryId));

    expect(response.status).toBe(401);
  });

  it('answers 404 for a caller with no shop', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const buyer = newClient(app);
    await registerAndLogin(buyer, 'buyer@example.test');

    const response = await create(buyer, validPayload(categoryId));

    expect(response.status).toBe(404);
  });

  it('refuses a shop that has not been approved yet', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    await seller.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(seller)).send({ communityId, name: 'ร้านทดสอบ' });

    const response = await create(seller, validPayload(categoryId));

    expect(response.status).toBe(403);
  });

  it('refuses a suspended shop (J2 · #38)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    await suspendShop(app, (await app.prisma.shop.findFirstOrThrow({ where: { communityId } })).id);

    const response = await create(seller, validPayload(categoryId));

    expect(response.status).toBe(403);
  });

  it('answers 404 for a category that does not exist, or is retired', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const seller = await sellerWithShop(app, SELLER, communityId);

    const missing = await create(seller, validPayload('01923abc-0000-7000-8000-000000000000'));
    expect(missing.status).toBe(404);

    const retiredCategoryId = await createCategory(superAdmin, 'ของเล่น');
    await superAdmin
      .patch(`${API}/categories/${retiredCategoryId}`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ name: 'ของเล่น', isActive: false });
    const retired = await create(seller, validPayload(retiredCategoryId));
    expect(retired.status).toBe(404);
  });

  it('creates a product starting at PENDING, with its variants', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);

    const response = await create(
      seller,
      validPayload(categoryId, { variants: [validVariant(), validVariant({ name: 'สีน้ำเงิน / ไซส์ L' })] }),
    );

    expect(response.status).toBe(201);
    const body = response.body as ProductBody;
    expect(body.moderationStatus).toBe('PENDING');
    expect(body.variants.length).toBe(2);
    expect(body.variants[0]?.priceAmountMinor).toBe(15000);
    expect(body.variants[0]?.currency).toBe('THB');
    expect(body.images).toEqual([]);
  });

  it('rejects a product with no variants at all', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);

    const response = await create(seller, validPayload(categoryId, { variants: [] }));

    expect(response.status).toBe(400);
  });

  it('rejects more than 50 variants (L7)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const tooMany = Array.from({ length: 51 }, (_, i) => validVariant({ name: `ตัวเลือกที่ ${i}` }));

    const response = await create(seller, validPayload(categoryId, { variants: tooMany }));

    expect(response.status).toBe(400);
  });

  it('rejects a non-positive price and a negative stock', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);

    const zeroPrice = await create(
      seller,
      validPayload(categoryId, { variants: [validVariant({ priceAmountMinor: 0 })] }),
    );
    expect(zeroPrice.status).toBe(400);

    const negativeStock = await create(
      seller,
      validPayload(categoryId, { variants: [validVariant({ stock: -1 })] }),
    );
    expect(negativeStock.status).toBe(400);
  });

  it('rejects a request that tries to set moderationStatus directly (no field for it exists)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);

    const response = await create(seller, validPayload(categoryId, { moderationStatus: 'APPROVED' }));

    expect(response.status).toBe(400);
  });
});

describe('a product’s photos (#41 · C4 · N1)', () => {
  it('adds a real jpeg and, once the product is approved, serves it back publicly, no session required', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const created = await create(seller, validPayload(categoryId));
    const productId = (created.body as ProductBody).id;

    const uploadResponse = await addImage(seller, productId, await aJpegBuffer());
    expect(uploadResponse.status).toBe(200);
    const imageId = (uploadResponse.body as ProductBody).images[0]?.id;
    expect(imageId).toBeDefined();
    // §109: a photo is public once an approval has covered it — before that, only its reviewers see it.
    expect((await approveProduct(superAdmin, productId)).status).toBe(200);

    const readResponse = await newClient(app).get(`${API}/products/${productId}/images/${imageId}`);
    expect(readResponse.status).toBe(200);
    expect(readResponse.headers['content-type']).toContain('image/jpeg');
  });

  it('rejects an 11th image', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const created = await create(seller, validPayload(categoryId));
    const productId = (created.body as ProductBody).id;

    for (let i = 0; i < 10; i += 1) {
      const response = await addImage(seller, productId, await aJpegBuffer());
      expect(response.status).toBe(200);
    }

    const eleventh = await addImage(seller, productId, await aJpegBuffer());
    expect(eleventh.status).toBe(409);
  });

  it('rejects a file that is not really a jpeg/png', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const created = await create(seller, validPayload(categoryId));
    const productId = (created.body as ProductBody).id;

    const response = await addImage(seller, productId, Buffer.from('not a real image'));

    expect(response.status).toBe(400);
  });

  it('removes a photo', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const created = await create(seller, validPayload(categoryId));
    const productId = (created.body as ProductBody).id;
    const uploaded = await addImage(seller, productId, await aJpegBuffer());
    const imageId = (uploaded.body as ProductBody).images[0]?.id as string;

    const response = await removeImage(seller, productId, imageId);

    expect(response.status).toBe(200);
    expect((response.body as ProductBody).images).toEqual([]);
  });

  it('answers 404 for another seller adding or removing a photo on a product that is not theirs', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityA);
    const created = await create(seller, validPayload(categoryId));
    const productId = (created.body as ProductBody).id;
    const uploaded = await addImage(seller, productId, await aJpegBuffer());
    const imageId = (uploaded.body as ProductBody).images[0]?.id as string;

    const otherSeller = await sellerWithShop(app, OTHER_SELLER, communityB);
    const addAttempt = await addImage(otherSeller, productId, await aJpegBuffer());
    const removeAttempt = await removeImage(otherSeller, productId, imageId);

    expect(addAttempt.status).toBe(404);
    expect(removeAttempt.status).toBe(404);
  });

  it('answers 404 reading an image id that does not exist', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const created = await create(seller, validPayload(categoryId));
    const productId = (created.body as ProductBody).id;

    const response = await newClient(app).get(
      `${API}/products/${productId}/images/01923abc-0000-7000-8000-000000000000`,
    );

    expect(response.status).toBe(404);
  });
});
