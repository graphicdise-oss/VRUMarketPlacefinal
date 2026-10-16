import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { adminProductRevision, approveProduct, rejectProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §103 (the security pass after area 4, the owner's decision): a product's photos are public by
 * design — an old link in an order must keep working — but not once the product is ruled
 * PROHIBITED. Then a photo of something the marketplace refused to sell is served only to the
 * shop's owner and the admins who can review it; everyone else gets the same 404 a photo that
 * never existed gets.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';

interface ProductBody {
  id: string;
  images: { id: string }[];
}

async function post(client: Agent, path: string, body: Record<string, unknown>) {
  return client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 0, b: 0 } } }).jpeg().toBuffer();
}

/** A shop in community A with one PENDING product carrying one photo, and admins inside and outside A. */
async function productWithPhoto(app: TestApp) {
  const superAdmin = app.client;
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  const communityA = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const communityB = ((await post(superAdmin, '/communities', { name: 'ชุมชนอ่างศิลา', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const categoryId = ((await post(superAdmin, '/categories', { name: 'ของใช้' })).body as { id: string }).id;

  const adminA = newClient(app);
  await post(superAdmin, `/communities/${communityA}/admins`, { userId: await registerVerified(app, adminA, 'admin-a@example.test') });
  const adminB = newClient(app);
  await post(superAdmin, `/communities/${communityB}/admins`, { userId: await registerVerified(app, adminB, 'admin-b@example.test') });

  const seller = newClient(app);
  await registerVerified(app, seller, 'seller@example.test');
  const shopId = ((await post(seller, '/shops', { communityId: communityA, name: 'ร้านทดสอบรูป' })).body as { id: string }).id;
  await approveShop(app, shopId);
  const productId = (
    (await post(seller, '/products', {
      name: 'สินค้าทดสอบรูป',
      description: 'คำอธิบายสินค้าสำหรับทดสอบ',
      categoryId,
      variants: [{ name: 'แบบเดียว', priceAmountMinor: 10000, stock: 5 }],
    })).body as { id: string }
  ).id;
  const uploaded = await seller
    .post(`${API}/products/${productId}/images`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .attach('file', await aJpegBuffer(), 'photo.jpg');
  const imageId = (uploaded.body as ProductBody).images[0]!.id;

  const stranger = newClient(app);
  await registerVerified(app, stranger, 'stranger@example.test');

  return { superAdmin, adminA, adminB, seller, stranger, productId, categoryId, photo: `${API}/products/${productId}/images/${imageId}` };
}

describe('§103 — a PROHIBITED product’s photos are no longer public', () => {
  it('only the shop’s owner and the admins who may review it can still open the photo; everyone else gets 404', async () => {
    const app = getApp();
    const { superAdmin, adminA, adminB, seller, stranger, productId, photo } = await productWithPhoto(app);
    // §109: approved first, so the photo is public before the ruling — the ruling is what hides it.
    expect((await approveProduct(adminA, productId)).status).toBe(200);
    expect((await newClient(app).get(photo)).status).toBe(200);

    expect((await rejectProduct(superAdmin, productId, { category: 'PROHIBITED', reason: 'เป็นสินค้าที่กฎหมายห้ามขาย' }, await adminProductRevision(superAdmin, productId))).status).toBe(200);

    expect((await newClient(app).get(photo)).status).toBe(404);
    expect((await stranger.get(photo)).status).toBe(404);
    expect((await adminB.get(photo)).status).toBe(404);

    for (const allowed of [seller, adminA, superAdmin]) {
      const seen = await allowed.get(photo);
      expect(seen.status).toBe(200);
      // Served to a few people now, so no shared cache may keep a copy for the rest.
      expect(seen.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('the seller editing it does not reopen the photo — it stays hidden until an admin approves the product again', async () => {
    const app = getApp();
    const { superAdmin, adminA, seller, productId, categoryId, photo } = await productWithPhoto(app);
    expect((await rejectProduct(superAdmin, productId, { category: 'PROHIBITED', reason: 'เป็นสินค้าที่กฎหมายห้ามขาย' })).status).toBe(200);

    // Code review of §103: any group-A edit sent the product back to PENDING and cleared the
    // PROHIBITED ruling with it, so re-saving the same name made the refused photos public again.
    const edited = await seller
      .patch(`${API}/products/${productId}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'สินค้าทดสอบรูป', description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ moderationStatus: 'PENDING', rejectionCategory: 'PROHIBITED' });
    expect((await newClient(app).get(photo)).status).toBe(404);

    // An admin who reviewed it again and approved it is what makes the photo public.
    expect((await approveProduct(adminA, productId)).status).toBe(200);
    expect((await newClient(app).get(photo)).status).toBe(200);
  });

  it('a NEEDS_FIX rejection changes nothing — its photos stay public, like an order’s old link needs', async () => {
    const app = getApp();
    const { superAdmin, adminA, productId, photo } = await productWithPhoto(app);
    // §109: a photo an approval covered — the one an order's old link points at.
    expect((await approveProduct(adminA, productId)).status).toBe(200);

    expect((await rejectProduct(superAdmin, productId, { category: 'NEEDS_FIX', reason: 'รูปไม่ชัด ขอรูปใหม่ที่เห็นสินค้าชัดเจน' }, await adminProductRevision(superAdmin, productId))).status).toBe(200);

    expect((await newClient(app).get(photo)).status).toBe(200);
  });

  it('an approved product’s photos are public, as before', async () => {
    const app = getApp();
    const { superAdmin, productId, photo } = await productWithPhoto(app);

    expect((await approveProduct(superAdmin, productId)).status).toBe(200);

    expect((await newClient(app).get(photo)).status).toBe(200);
  });
});
