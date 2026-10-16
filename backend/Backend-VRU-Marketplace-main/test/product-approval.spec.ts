import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct, approveShopAs, productRevision, rejectProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #43: approving/rejecting products — the two-tier guard's (#32) next real user after `Shop`,
 * resolved through the product's own shop since a product has no `communityId` of its own (A6).
 * A rejection carries one of two machine-readable categories (H4) plus a reason; nobody, admin
 * or super admin, approves their own shop's product (N28, extended from #35/#38).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const SELLER = 'seller@example.test';
const OWNER_ADMIN = 'owner-admin@example.test';
const BUYER = 'buyer@example.test';

interface ProductBody {
  id: string;
  moderationStatus: string;
  rejectionCategory: string | null;
  rejectionReason: string | null;
}

interface MineListBody {
  items: ProductBody[];
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

async function assignAdmin(superAdmin: Agent, communityId: string, userId: string): Promise<void> {
  await superAdmin
    .post(`${API}/communities/${communityId}/admins`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ userId });
}

/** A seller with an APPROVED shop and a PENDING product, ready to be reviewed. */
async function sellerWithPendingProduct(
  app: TestApp,
  email: string,
  communityId: string,
  categoryId: string,
): Promise<{ client: Agent; productId: string }> {
  const seller = newClient(app);
  await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name: 'เสื้อยืดลายชุมชน',
      description: 'ผ้าคอตตอน 100%',
      categoryId,
      variants: [{ name: 'ไซส์ M', priceAmountMinor: 15000, stock: 10 }],
    });

  return { client: seller, productId: (created.body as ProductBody).id };
}

async function approve(client: Agent, productId: string, seen?: number) {
  return approveProduct(client, productId, seen);
}

async function reject(client: Agent, productId: string, category: string, reason: string, seen?: number) {
  return rejectProduct(client, productId, { category, reason }, seen);
}

describe('who may approve or reject a product (the guard from #32, for real)', () => {
  it('lets the product’s shop’s community admin approve it', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const admin = newClient(app);
    const adminSession = await registerAndLogin(admin, ADMIN_A);
    const adminId = (adminSession.body as { id: string }).id;
    await assignAdmin(superAdmin, communityId, adminId);

    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const response = await approve(admin, productId);

    expect(response.status).toBe(200);
    expect((response.body as ProductBody).moderationStatus).toBe('APPROVED');

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'PRODUCT_APPROVED', targetId: productId },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorUserId).toBe(adminId);
    expect(entry?.communityId).toBe(communityId);
  });

  it('refuses community A’s admin approving or rejecting a product of a shop in community B', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const adminA = newClient(app);
    const adminASession = await registerAndLogin(adminA, ADMIN_A);
    const adminAId = (adminASession.body as { id: string }).id;
    await assignAdmin(superAdmin, communityA, adminAId);

    const { productId } = await sellerWithPendingProduct(app, SELLER, communityB, categoryId);

    // §91: this admin cannot see the product in their queue, so there is no revision to read —
    // the guard must refuse before the revision is ever looked at.
    const approveResult = await approve(adminA, productId, 0);
    expect(approveResult.status).toBe(403);

    const rejectResult = await reject(adminA, productId, 'NEEDS_FIX', 'เหตุผลสำหรับทดสอบการปฏิเสธ', 0);
    expect(rejectResult.status).toBe(403);

    await expect(
      app.prisma.product.findUnique({ where: { id: productId }, select: { moderationStatus: true } }),
    ).resolves.toEqual({ moderationStatus: 'PENDING' });
  });

  it('lets a super admin approve without any CommunityAdmin row', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const response = await approve(superAdmin, productId);

    expect(response.status).toBe(200);
  });

  it('refuses an ordinary signed-in user with no CommunityAdmin row anywhere', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await approve(buyer, productId, 0);

    expect(response.status).toBe(403);
  });

  it('requires a session', async () => {
    const response = await newClient(getApp())
      .post(`${API}/products/${newId()}/approve`)
      .send();

    expect(response.status).toBe(401);
  });
});

describe('rejecting a product needs a machine-readable category and a reason the seller can read (H4)', () => {
  it('rejects with NEEDS_FIX, and the seller reads both the category and reason back through GET /products/mine', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const admin = newClient(app);
    const adminSession = await registerAndLogin(admin, ADMIN_A);
    const adminId = (adminSession.body as { id: string }).id;
    await assignAdmin(superAdmin, communityId, adminId);

    const { client: seller, productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const reason = 'รูปสินค้าเบลอเกินไป มองไม่เห็นรายละเอียด กรุณาอัปโหลดรูปใหม่ที่ชัดกว่านี้';
    const response = await reject(admin, productId, 'NEEDS_FIX', reason);

    expect(response.status).toBe(200);
    const body = response.body as ProductBody;
    expect(body.moderationStatus).toBe('REJECTED');
    expect(body.rejectionCategory).toBe('NEEDS_FIX');
    expect(body.rejectionReason).toBe(reason);

    // Code review (2026-09-22, §78): GET /products/:productId is invariant 1's *public* view and
    // 404s the instant a product leaves APPROVED — before this route existed, a seller had no way
    // at all to read this back, despite the response above proving the data was written.
    expect((await seller.get(`${API}/products/${productId}`)).status).toBe(404);
    const mine = await seller.get(`${API}/products/mine`);
    expect(mine.status).toBe(200);
    const mineProduct = (mine.body as MineListBody).items.find((item) => item.id === productId);
    expect(mineProduct?.moderationStatus).toBe('REJECTED');
    expect(mineProduct?.rejectionCategory).toBe('NEEDS_FIX');
    expect(mineProduct?.rejectionReason).toBe(reason);

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'PRODUCT_REJECTED', targetId: productId },
    });
    expect(entry?.reason).toContain('NEEDS_FIX');
    expect(entry?.reason).toContain(reason);
    expect(entry?.communityId).toBe(communityId);

    // Code review (2026-09-22, §78): the old message text pointed sellers at a page that never
    // existed ("กรุณาตรวจสอบเหตุผลที่หน้าสินค้า") — the category and reason now ride in the
    // message itself, same shape as §77's SHOP_REJECTED.
    const sellerId = (
      await app.prisma.shop.findFirstOrThrow({ where: { products: { some: { id: productId } } } })
    ).ownerId;
    const notification = await app.prisma.notification.findFirst({
      where: { userId: sellerId, type: 'PRODUCT_REJECTED' },
    });
    expect(notification?.message).toContain('NEEDS_FIX');
    expect(notification?.message).toContain(reason);
  });

  it('rejects with PROHIBITED as a distinct, queryable category', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const response = await reject(superAdmin, productId, 'PROHIBITED', 'เป็นสินค้าที่กฎหมายห้ามขาย');

    expect(response.status).toBe(200);
    expect((response.body as ProductBody).rejectionCategory).toBe('PROHIBITED');

    await expect(
      app.prisma.product.count({ where: { id: productId, rejectionCategory: 'PROHIBITED' } }),
    ).resolves.toBe(1);
  });

  it('answers 400 for a missing category, and for a reason that is too short', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const missingCategory = await superAdmin
      .post(`${API}/products/${productId}/reject`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: 'เหตุผลที่ยาวพอสำหรับทดสอบ', reviewRevision: 0 });
    expect(missingCategory.status).toBe(400);
    expect((missingCategory.body as ErrorBody).fieldErrors).toHaveProperty('category');

    const shortReason = await reject(superAdmin, productId, 'NEEDS_FIX', 'สั้นไป');
    expect(shortReason.status).toBe(400);
  });
});

describe('approving or rejecting an already-decided product', () => {
  it('answers 409 approving a product that was already approved', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);
    // §91: the revision a second reviewer's screen still shows — the product has left the queue.
    const seen = await productRevision(superAdmin, productId);
    await approve(superAdmin, productId);

    const response = await approve(superAdmin, productId, seen);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });

  it(
    'answers 403 for a community admin approving a product that does not exist — the guard ' +
      '(#32) refuses before this route’s own code ever runs',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

      const admin = newClient(app);
      const adminSession = await registerAndLogin(admin, ADMIN_A);
      const adminId = (adminSession.body as { id: string }).id;
      await assignAdmin(superAdmin, communityId, adminId);

      const response = await approve(admin, newId(), 0);

      expect(response.status).toBe(403);
    },
  );

  it(
    'answers a plain 404 for a super admin — the one caller the guard lets straight through ' +
      'without asking the resolver anything',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);

      const response = await approve(superAdmin, newId(), 0);

      expect(response.status).toBe(404);
    },
  );
});

describe('a deleted product is not a reviewable one (§79)', () => {
  it('drops out of the review queue, and approve/reject answer 404', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller, productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const queueBefore = await superAdmin.get(`${API}/products/pending`);
    expect((queueBefore.body as { items: { id: string }[] }).items.map((item) => item.id)).toContain(productId);
    const seen = await productRevision(superAdmin, productId);

    const deleted = await seller.delete(`${API}/products/${productId}`).set(CSRF_HEADER, await csrfToken(seller));
    expect(deleted.status).toBe(204);

    // Before this fix the queue kept listing it and approving it still answered 200 — writing an
    // audit entry and telling the owner that something they had deleted had just gone live.
    const queueAfter = await superAdmin.get(`${API}/products/pending`);
    expect((queueAfter.body as { items: { id: string }[] }).items.map((item) => item.id)).not.toContain(productId);

    expect((await approve(superAdmin, productId, seen)).status).toBe(404);
    expect((await reject(superAdmin, productId, 'NEEDS_FIX', 'เหตุผลสำหรับทดสอบการปฏิเสธ', seen)).status).toBe(404);

    await expect(
      app.prisma.product.findUnique({ where: { id: productId }, select: { moderationStatus: true } }),
    ).resolves.toEqual({ moderationStatus: 'PENDING' });
    await expect(app.prisma.auditLog.count({ where: { targetId: productId } })).resolves.toBe(0);
  });
});

describe('two admins deciding the same product at once (§79)', () => {
  it('lets exactly one approval through, and answers 409 to the other', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    // The PENDING check used to run before the transaction and the write was unconditional, so
    // both calls could pass the check and both write. The condition now rides on the write itself
    // (the shape OrderService.setShippingFee already used), which is what makes this deterministic.
    const [first, second] = await Promise.all([approve(superAdmin, productId), approve(superAdmin, productId)]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    await expect(
      app.prisma.auditLog.count({ where: { action: 'PRODUCT_APPROVED', targetId: productId } }),
    ).resolves.toBe(1);
    await expect(
      app.prisma.notification.count({ where: { type: 'PRODUCT_APPROVED', targetId: productId } }),
    ).resolves.toBe(1);
  });
});

describe('a shop owner may not approve or reject their own product (N28, extended)', () => {
  it('refuses an owner who was later made super admin — the one route to owner-and-admin §85 (N29) cannot close', async () => {
    // Since §85 an admin cannot apply for a shop and a shop owner cannot be made a community
    // admin, so the arrangement N28 guards against is built the only way still possible: the
    // role column set directly in the database, which is how every super admin is made.
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const ownerAdmin = newClient(app);
    await registerVerified(app, ownerAdmin, OWNER_ADMIN);
    const applied = await ownerAdmin
      .post(`${API}/shops`)
      .set(CSRF_HEADER, await csrfToken(ownerAdmin))
      .send({ communityId, name: 'ร้านทดสอบ' });
    await approveShopAs(superAdmin, (applied.body as { id: string }).id);
    const created = await ownerAdmin
      .post(`${API}/products`)
      .set(CSRF_HEADER, await csrfToken(ownerAdmin))
      .send({
        name: 'สินค้าของตัวเอง',
        description: 'คำอธิบาย',
        categoryId,
        variants: [{ name: 'แบบเดียว', priceAmountMinor: 1000, stock: 1 }],
      });
    const productId = (created.body as ProductBody).id;
    // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
    await app.prisma.user.update({ where: { email: OWNER_ADMIN }, data: { role: 'SUPER_ADMIN' } });

    const approveResult = await approve(ownerAdmin, productId);
    expect(approveResult.status).toBe(403);

    const rejectResult = await reject(ownerAdmin, productId, 'NEEDS_FIX', 'เหตุผลสำหรับทดสอบการปฏิเสธ');
    expect(rejectResult.status).toBe(403);

    await expect(
      app.prisma.product.findUnique({ where: { id: productId }, select: { moderationStatus: true } }),
    ).resolves.toEqual({ moderationStatus: 'PENDING' });
  });
});

describe('GET /products/pending — scoped to the caller automatically', () => {
  it('shows a community admin only the pending products of communities they administer', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    const adminA = newClient(app);
    const adminASession = await registerAndLogin(adminA, ADMIN_A);
    const adminAId = (adminASession.body as { id: string }).id;
    await assignAdmin(superAdmin, communityA, adminAId);

    const { productId: productA } = await sellerWithPendingProduct(app, SELLER, communityA, categoryId);
    await sellerWithPendingProduct(app, OWNER_ADMIN, communityB, categoryId);

    const response = await adminA.get(`${API}/products/pending`);

    expect(response.status).toBe(200);
    const body = response.body as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toEqual([productA]);
  });

  it('shows a super admin every pending product across every community', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

    await sellerWithPendingProduct(app, SELLER, communityA, categoryId);
    await sellerWithPendingProduct(app, OWNER_ADMIN, communityB, categoryId);

    const response = await superAdmin.get(`${API}/products/pending`);

    expect((response.body as { items: unknown[] }).items).toHaveLength(2);
  });

  it('answers an empty page, not 403, for a signed-in caller who administers nothing', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await buyer.get(`${API}/products/pending`);

    expect(response.status).toBe(200);
    expect((response.body as { items: unknown[] }).items).toEqual([]);
  });

  it('does not include an already-approved product', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);
    await approve(superAdmin, productId);

    const response = await superAdmin.get(`${API}/products/pending`);

    expect((response.body as { items: { id: string }[] }).items.some((item) => item.id === productId)).toBe(
      false,
    );
  });
});

describe('an approved product appears in the public list (#42 integration)', () => {
  it('shows up on GET /products once approved, having not shown up before', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { productId } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const beforeApproval = await newClient(app).get(`${API}/products`);
    expect(
      (beforeApproval.body as { items: { id: string }[] }).items.some((item) => item.id === productId),
    ).toBe(false);

    await approve(superAdmin, productId);

    const afterApproval = await newClient(app).get(`${API}/products`);
    expect(
      (afterApproval.body as { items: { id: string }[] }).items.some((item) => item.id === productId),
    ).toBe(true);
  });
});

describe('GET /products/mine (§78) — the seller’s own catalogue, across every moderation status', () => {
  it('lists a PENDING, an APPROVED, and a REJECTED product of the caller’s own shop', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller, productId: pending } = await sellerWithPendingProduct(app, SELLER, communityId, categoryId);

    const created = await seller
      .post(`${API}/products`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({
        name: 'กางเกงผ้าฝ้าย',
        description: 'ผ้าฝ้าย 100%',
        categoryId,
        variants: [{ name: 'ไซส์ M', priceAmountMinor: 12000, stock: 5 }],
      });
    const approved = (created.body as ProductBody).id;
    await approve(superAdmin, approved);

    const thirdProduct = await seller
      .post(`${API}/products`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({
        name: 'หมวกไหมพรม',
        description: 'ถักมือ',
        categoryId,
        variants: [{ name: 'ไซส์ฟรี', priceAmountMinor: 8000, stock: 2 }],
      });
    const rejected = (thirdProduct.body as ProductBody).id;
    await reject(superAdmin, rejected, 'NEEDS_FIX', 'ต้องแก้ไขรูปสินค้าก่อนอนุมัติ');

    const response = await seller.get(`${API}/products/mine`);

    expect(response.status).toBe(200);
    const ids = (response.body as MineListBody).items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([pending, approved, rejected]));
  });

  it('answers 404 for a caller with no shop, and 401 with no session', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await buyer.get(`${API}/products/mine`);
    expect(response.status).toBe(404);

    const anonymous = await newClient(app).get(`${API}/products/mine`);
    expect(anonymous.status).toBe(401);
  });
});
