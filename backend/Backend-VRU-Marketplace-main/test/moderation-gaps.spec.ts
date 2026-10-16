import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { FileStorageService } from '../src/files/file-storage.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { adminProductRevision, approveProduct, profileChangeRevision, rejectProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * §109 (the shops + moderation scrutiny, the owner's decisions):
 * - an admin can take down a product that is already approved, with the same reject (and its
 *   PROHIBITED consequences) a pending product gets;
 * - a photo nobody has reviewed is served only to the shop's owner and the admins who may review
 *   it — a photo that was approved stays public while its product is re-reviewed;
 * - a photo the shop removes is deleted from disk;
 * - only an approved, open shop can be suspended, and closing a shop drops its waiting profile change.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const PRODUCT = { name: 'ขนมชั้นใบเตย', description: 'คำอธิบายสินค้าสำหรับทดสอบ' };

async function post(client: Agent, path: string, body?: object) {
  const request = client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client));
  return body === undefined ? request : request.send(body);
}

async function jpeg(red: number): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: red, g: 0, b: 0 } } }).jpeg().toBuffer();
}

/** Two communities with an admin each, and a seller whose approved shop is in community A. */
async function marketplace(app: TestApp) {
  const superAdmin = app.client;
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  const communityA = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const communityB = ((await post(superAdmin, '/communities', { name: 'ชุมชนอ่างศิลา', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const categoryId = ((await post(superAdmin, '/categories', { name: 'ขนมไทย' })).body as { id: string }).id;

  const adminA = newClient(app);
  await post(superAdmin, `/communities/${communityA}/admins`, { userId: await registerVerified(app, adminA, 'admin-a@example.test') });
  const adminB = newClient(app);
  await post(superAdmin, `/communities/${communityB}/admins`, { userId: await registerVerified(app, adminB, 'admin-b@example.test') });

  const seller = newClient(app);
  await registerVerified(app, seller, 'seller@example.test');
  const shopId = ((await post(seller, '/shops', { communityId: communityA, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
  await approveShop(app, shopId);

  return { superAdmin, adminA, adminB, seller, shopId, communityA, categoryId };
}

async function createProduct(seller: Agent, categoryId: string): Promise<{ productId: string; variantId: string }> {
  const created = (await post(seller, '/products', { ...PRODUCT, categoryId, variants: [{ name: 'กล่องเล็ก', priceAmountMinor: 10000, stock: 5 }] })).body as {
    id: string;
    variants: { id: string }[];
  };
  return { productId: created.id, variantId: created.variants[0]!.id };
}

async function uploadPhoto(seller: Agent, productId: string, red = 200): Promise<string> {
  const res = await seller.post(`${API}/products/${productId}/images`).set(CSRF_HEADER, await csrfToken(seller)).attach('file', await jpeg(red), 'photo.jpg');
  expect(res.status).toBe(200);
  return (res.body as { images: { id: string }[] }).images.at(-1)!.id;
}

async function placeOrder(app: TestApp, variantId: string): Promise<{ buyer: Agent; orderId: string }> {
  const buyer = newClient(app);
  await registerVerified(app, buyer, 'buyer@example.test');
  const spc = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  const address = (await post(buyer, '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId: spc.id })).body as {
    id: string;
  };
  await post(buyer, '/cart/items', { variantId, quantity: 1 });
  const placed = await checkoutAsShown(buyer, address.id);
  expect(placed.status).toBe(201);
  const body = placed.body as { orders?: { id: string }[]; items?: { id: string }[] } | { id: string }[];
  const orders = Array.isArray(body) ? body : (body.orders ?? body.items ?? []);
  return { buyer, orderId: orders[0]!.id };
}

async function listedProductIds(): Promise<string[]> {
  return ((await newClient(getApp()).get(`${API}/products`)).body as { items: { id: string }[] }).items.map((product) => product.id);
}

describe('§109 — an admin can take down a product that is already approved', () => {
  it('a community admin rejects a live product as PROHIBITED: it leaves the storefront and its unpaid order is cancelled', async () => {
    const app = getApp();
    const { superAdmin, adminA, seller, categoryId } = await marketplace(app);
    const { productId, variantId } = await createProduct(seller, categoryId);
    expect((await approveProduct(superAdmin, productId)).status).toBe(200);
    const { buyer, orderId } = await placeOrder(app, variantId);

    const rejected = await rejectProduct(adminA, productId, { category: 'PROHIBITED', reason: 'ผู้ซื้อแจ้งว่าเป็นสินค้าต้องห้าม ตรวจแล้วเป็นจริง' }, await adminProductRevision(adminA, productId));

    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ moderationStatus: 'REJECTED', rejectionCategory: 'PROHIBITED' });
    expect(await listedProductIds()).not.toContain(productId);
    expect(((await buyer.get(`${API}/orders/${orderId}`)).body as { status: string }).status).toBe('CANCELLED');
  });

  it('NEEDS_FIX on a live product hides it and leaves orders in flight alone (H4)', async () => {
    const app = getApp();
    const { superAdmin, adminA, seller, categoryId } = await marketplace(app);
    const { productId, variantId } = await createProduct(seller, categoryId);
    expect((await approveProduct(superAdmin, productId)).status).toBe(200);
    const { buyer, orderId } = await placeOrder(app, variantId);

    const rejected = await rejectProduct(adminA, productId, { category: 'NEEDS_FIX', reason: 'รูปไม่ตรงกับสินค้าจริง ขอรูปใหม่' }, await adminProductRevision(adminA, productId));

    expect(rejected.status).toBe(200);
    expect(await listedProductIds()).not.toContain(productId);
    expect(((await buyer.get(`${API}/orders/${orderId}`)).body as { status: string }).status).toBe('AWAITING_SHIPPING_QUOTE');
  });

  it('an admin of another community can neither view nor take down a product in community A', async () => {
    const app = getApp();
    const { superAdmin, adminB, seller, categoryId } = await marketplace(app);
    const { productId } = await createProduct(seller, categoryId);
    expect((await approveProduct(superAdmin, productId)).status).toBe(200);

    expect((await adminB.get(`${API}/products/${productId}/admin`)).status).toBe(403);
    const rejected = await rejectProduct(adminB, productId, { category: 'PROHIBITED', reason: 'พยายามถอดสินค้าข้ามชุมชน' }, 1);
    expect(rejected.status).toBe(403);
    expect(await listedProductIds()).toContain(productId);
  });

  it('an approved product still cannot be approved again, and a rejected one cannot be rejected twice', async () => {
    const app = getApp();
    const { superAdmin, adminA, seller, categoryId } = await marketplace(app);
    const { productId } = await createProduct(seller, categoryId);
    expect((await approveProduct(superAdmin, productId)).status).toBe(200);
    const seen = await adminProductRevision(adminA, productId);

    expect((await approveProduct(adminA, productId, seen)).status).toBe(409);
    expect((await rejectProduct(adminA, productId, { category: 'NEEDS_FIX', reason: 'ขอรูปใหม่ที่ชัดกว่านี้' }, seen)).status).toBe(200);
    expect((await rejectProduct(adminA, productId, { category: 'NEEDS_FIX', reason: 'ขอรูปใหม่ที่ชัดกว่านี้' }, seen)).status).toBe(409);
  });
});

describe('§109 — a photo nobody has reviewed is not public', () => {
  it('a never-approved product’s photo: only its owner and the admins who may review it can open it, until it is approved', async () => {
    const app = getApp();
    const { superAdmin, adminA, adminB, seller, categoryId } = await marketplace(app);
    const { productId } = await createProduct(seller, categoryId);
    const photo = `${API}/products/${productId}/images/${await uploadPhoto(seller, productId)}`;

    expect((await newClient(app).get(photo)).status).toBe(404);
    expect((await adminB.get(photo)).status).toBe(404);
    for (const allowed of [seller, adminA, superAdmin]) {
      const seen = await allowed.get(photo);
      expect(seen.status).toBe(200);
      expect(seen.headers['cache-control']).toBe('private, no-store');
    }

    expect((await approveProduct(adminA, productId)).status).toBe(200);
    expect((await newClient(app).get(photo)).status).toBe(200);
  });

  it('a photo added to a live product waits for review — the photos already approved stay public meanwhile', async () => {
    const app = getApp();
    const { adminA, seller, categoryId } = await marketplace(app);
    const { productId } = await createProduct(seller, categoryId);
    const approvedPhoto = `${API}/products/${productId}/images/${await uploadPhoto(seller, productId, 200)}`;
    expect((await approveProduct(adminA, productId)).status).toBe(200);

    const newPhoto = `${API}/products/${productId}/images/${await uploadPhoto(seller, productId, 90)}`;

    expect((await newClient(app).get(newPhoto)).status).toBe(404);
    expect((await newClient(app).get(approvedPhoto)).status).toBe(200);
    expect((await approveProduct(adminA, productId)).status).toBe(200);
    expect((await newClient(app).get(newPhoto)).status).toBe(200);
  });
});

describe('§109 — a removed photo leaves the disk', () => {
  it('removing a product photo deletes its file, so upload-and-remove cannot fill the server', async () => {
    const app = getApp();
    const { seller, categoryId } = await marketplace(app);
    const { productId } = await createProduct(seller, categoryId);
    const imageId = await uploadPhoto(seller, productId);
    // Read-only look at the stored file's id and, below, whether its bytes and row remain — the disk
    // is not reachable over HTTP, the same observation §86's logo tests make.
    const fileId = (await app.prisma.productImage.findUniqueOrThrow({ where: { id: imageId } })).fileId;

    const removed = await seller.delete(`${API}/products/${productId}/images/${imageId}`).set(CSRF_HEADER, await csrfToken(seller));

    expect(removed.status).toBe(200);
    expect(await app.app.get(FileStorageService).readImage(fileId)).toBeNull();
    expect(await app.prisma.uploadedFile.findUnique({ where: { id: fileId } })).toBeNull();
  });
});

describe('§109 — suspension is for a shop that is selling, and a closed shop takes no profile change', () => {
  it('a closed shop and a shop not yet approved cannot be suspended', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, communityA } = await marketplace(app);
    expect((await post(seller, `/shops/${shopId}/close`)).status).toBe(200);

    expect((await post(superAdmin, `/shops/${shopId}/suspend`, { reason: 'ระงับร้านที่ปิดไปแล้วเพื่อทดสอบ' })).status).toBe(409);

    const pendingId = ((await post(seller, '/shops', { communityId: communityA, name: 'ร้านใหม่รออนุมัติ' })).body as { id: string }).id;
    expect((await post(superAdmin, `/shops/${pendingId}/suspend`, { reason: 'ระงับร้านที่ยังไม่อนุมัติเพื่อทดสอบ' })).status).toBe(409);
  });

  it('closing a shop drops its waiting profile change, and its waiting logo leaves the disk', async () => {
    const app = getApp();
    const { adminA, seller, shopId } = await marketplace(app);
    expect((await seller.patch(`${API}/shops/me`).set(CSRF_HEADER, await csrfToken(seller)).send({ name: 'ชื่อใหม่ที่ยังไม่ตรวจ', description: 'คำอธิบายใหม่' })).status).toBe(200);
    const logo = await seller.post(`${API}/shops/me/logo`).set(CSRF_HEADER, await csrfToken(seller)).attach('file', await jpeg(120), 'logo.jpg');
    expect(logo.status).toBe(200);
    const seen = await profileChangeRevision(adminA, shopId);
    // Read-only: which file the waiting logo is, to check below that closing removed it from disk.
    const pendingLogoId = (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).pendingLogoFileId!;

    expect((await post(seller, `/shops/${shopId}/close`)).status).toBe(200);

    expect((await seller.get(`${API}/shops/me`)).body).toMatchObject({ pendingName: null, hasPendingLogo: false });
    expect((await post(adminA, `/shops/${shopId}/profile-change/approve`, { reviewRevision: seen })).status).toBe(409);
    expect((await newClient(app).get(`${API}/shops/${shopId}`)).body).toMatchObject({ name: 'ร้านขนมป้าแดง' });
    expect(await app.prisma.uploadedFile.findUnique({ where: { id: pendingLogoId } })).toBeNull();
  });
});
