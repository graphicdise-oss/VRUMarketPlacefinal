import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { newId } from '../src/common/id.js';
import { SEARCH_MATCH_SCAN_LIMIT } from '../src/product/services/product.service.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #45 (N5): Thai-language search via `pg_trgm` — `ILIKE` for a plain substring match, `<%`
 * (`word_similarity`) for one typo's worth of tolerance. Every test here uses real Thai product
 * names with no spaces between words, the same trap DECISIONS.md N5 measured against real
 * PostgreSQL: a test written with English words would pass even if `to_tsvector` were used by
 * mistake, because English tokenises on whitespace and Thai does not.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';

interface PublicProductBody {
  id: string;
}
interface ProductBody {
  id: string;
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

/** An approved, published product with the given name — searchable by construction. */
async function anApprovedProductNamed(app: TestApp, seller: Agent, categoryId: string, name: string): Promise<string> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name,
      description: 'คำอธิบายสินค้าสำหรับทดสอบ',
      categoryId,
      variants: [{ name: 'แบบเดียว', priceAmountMinor: 15000, stock: 10 }],
    });
  const productId = (created.body as ProductBody).id;
  await app.prisma.product.update({ where: { id: productId }, data: { moderationStatus: 'APPROVED' } });

  return productId;
}

async function search(client: Agent, q: string, extra: Record<string, string> = {}) {
  return client.get(`${API}/products/search`).query({ q, ...extra });
}

describe('Thai-language product search (#45 · N5 — pg_trgm, not tsvector)', () => {
  it('finds a Thai product by a search term at the start of the (spaceless) name', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดสีขาวคอกลม');

    const response = await search(newClient(app), 'เสื้อ');

    expect(response.status).toBe(200);
    expect((response.body as { items: PublicProductBody[] }).items.map((item) => item.id)).toContain(productId);
  });

  it('finds a search term in the middle of the name, not only at the start', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProductNamed(app, seller, categoryId, 'กระเป๋าผ้าสะพายข้างลายดอกไม้');

    const response = await search(newClient(app), 'สะพายข้าง');

    expect((response.body as { items: PublicProductBody[] }).items.map((item) => item.id)).toContain(productId);
  });

  it('⚠️ tolerates one typo via `<%` (word_similarity) — the test that catches `%` used by mistake', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    // Long, realistic name on purpose (N5): a short name would pass with `%`/`similarity` too and
    // hide the exact bug this test exists to catch.
    const productId = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดสีขาว คอกลม รุ่นพิเศษ 12');

    // 'เสื้อยิด' — one character wrong (ื → ิ) versus 'เสื้อยืด'.
    const response = await search(newClient(app), 'เสื้อยิด');

    expect((response.body as { items: PublicProductBody[] }).items.map((item) => item.id)).toContain(productId);
  });

  it('an anonymous caller may search — no session required (invariant 1)', async () => {
    const response = await search(newClient(getApp()), 'เสื้อ');

    expect(response.status).toBe(200);
  });

  it('does not find a product with no matching Thai text at all', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const productId = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดสีขาวคอกลม');

    const response = await search(newClient(app), 'รองเท้าหนังแท้');

    expect((response.body as { items: PublicProductBody[] }).items.map((item) => item.id)).not.toContain(productId);
  });

  describe('search still goes through invariant 6’s single visibility point (#42) — not a second copy of the rule', () => {
    it('never returns a product still pending moderation', async () => {
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
          name: 'เสื้อยืดรอตรวจสอบ',
          description: 'คำอธิบาย',
          categoryId,
          variants: [{ name: 'แบบเดียว', priceAmountMinor: 1000, stock: 5 }],
        });
      const productId = (created.body as ProductBody).id;

      const response = await search(newClient(app), 'เสื้อยืด');

      expect((response.body as { items: PublicProductBody[] }).items.map((item) => item.id)).not.toContain(productId);
    });

    it('never returns a product the shop unpublished', async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
      const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
      const { client: seller } = await sellerWithShop(app, SELLER, communityId);
      const productId = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดถูกซ่อนไว้');
      await seller.post(`${API}/products/${productId}/unpublish`).set(CSRF_HEADER, await csrfToken(seller));

      const response = await search(newClient(app), 'เสื้อยืด');

      expect((response.body as { items: PublicProductBody[] }).items.map((item) => item.id)).not.toContain(productId);
    });

    it('never returns a suspended shop’s product', async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
      const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
      const { client: seller, shopId } = await sellerWithShop(app, SELLER, communityId);
      const productId = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดร้านถูกระงับ');
      await suspendShop(app, shopId);

      const response = await search(newClient(app), 'เสื้อยืด');

      expect((response.body as { items: PublicProductBody[] }).items.map((item) => item.id)).not.toContain(productId);
    });

    it('never returns a soft-deleted product', async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
      const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
      const { client: seller } = await sellerWithShop(app, SELLER, communityId);
      const productId = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดถูกลบ');
      await app.prisma.product.update({ where: { id: productId }, data: { deletedAt: app.clock.now() } });

      const response = await search(newClient(app), 'เสื้อยืด');

      expect((response.body as { items: PublicProductBody[] }).items.map((item) => item.id)).not.toContain(productId);
    });
  });

  it('filters by communityId together with the search term', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: sellerA } = await sellerWithShop(app, SELLER, communityA);
    const { client: sellerB } = await sellerWithShop(app, OTHER_SELLER, communityB);
    const productA = await anApprovedProductNamed(app, sellerA, categoryId, 'เสื้อยืดของชุมชนบางแสน');
    const productB = await anApprovedProductNamed(app, sellerB, categoryId, 'เสื้อยืดของชุมชนศรีราชา');

    const response = await search(newClient(app), 'เสื้อยืด', { communityId: communityA });

    const ids = (response.body as { items: PublicProductBody[] }).items.map((item) => item.id);
    expect(ids).toContain(productA);
    expect(ids).not.toContain(productB);
  });

  it('paginates with the {items, nextCursor, hasMore} envelope, without duplicating or skipping rows', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    const ids = [
      await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดหมายเลขหนึ่ง'),
      await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดหมายเลขสอง'),
      await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดหมายเลขสาม'),
    ];

    const anon = newClient(app);
    const firstPage = await search(anon, 'เสื้อยืด', { limit: '2' });
    expect(firstPage.status).toBe(200);
    const firstBody = firstPage.body as { items: PublicProductBody[]; nextCursor: string | null; hasMore: boolean };
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await search(anon, 'เสื้อยืด', { limit: '2', cursor: firstBody.nextCursor! });
    const secondBody = secondPage.body as { items: PublicProductBody[]; hasMore: boolean };
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.hasMore).toBe(false);

    const seenIds = [...firstBody.items, ...secondBody.items].map((item) => item.id);
    expect(new Set(seenIds).size).toBe(3);
    expect(seenIds.sort()).toEqual([...ids].sort());
  });

  // Code review (2026-09-22, §79): the cursor used to be spread into the Prisma query's `where`
  // *after* `id: { in: matchedIds }`, so it overwrote the match set outright and page 2 answered
  // with whatever products happened to be older than the cursor, `q` ignored entirely. The test
  // above missed it because all three of its fixtures matched the query.
  it('⚠️ page 2 still honours the search term — a non-matching product never leaks into it', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller } = await sellerWithShop(app, SELLER, communityId);
    // Created oldest-first, so the non-matching product sits *between* the two matches: with
    // newest-first paging at limit=1 it is exactly what page 2 returns if `q` gets dropped.
    const olderMatch = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดหมายเลขสอง');
    const intruder = await anApprovedProductNamed(app, seller, categoryId, 'รองเท้าหนังแท้สีดำ');
    const newerMatch = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดหมายเลขหนึ่ง');

    const anon = newClient(app);
    const firstPage = await search(anon, 'เสื้อยืด', { limit: '1' });
    const firstBody = firstPage.body as { items: PublicProductBody[]; nextCursor: string | null; hasMore: boolean };
    expect(firstBody.items.map((item) => item.id)).toEqual([newerMatch]);
    expect(firstBody.hasMore).toBe(true);

    const secondPage = await search(anon, 'เสื้อยืด', { limit: '1', cursor: firstBody.nextCursor! });
    const secondIds = (secondPage.body as { items: PublicProductBody[] }).items.map((item) => item.id);

    expect(secondIds).not.toContain(intruder);
    expect(secondIds).toEqual([olderMatch]);
  });

  // Code review (2026-09-22, §79): the match query is capped at SEARCH_MATCH_SCAN_LIMIT ids. A
  // batch that fills the cap without filling a page must keep paging from the last id *scanned* —
  // reporting hasMore: false there would end the search at the batch boundary rather than at the
  // end of the matches.
  it('keeps paging when a whole batch of matches is invisible, instead of ending the search early', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { client: seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    // The one visible match is created first, so every id below is newer than it and fills the
    // whole first batch — leaving this one to be found only by paging past that batch.
    const visible = await anApprovedProductNamed(app, seller, categoryId, 'เสื้อยืดตัวที่มองเห็นได้');
    const now = app.clock.now();
    await app.prisma.product.createMany({
      data: Array.from({ length: SEARCH_MATCH_SCAN_LIMIT }, (_, index) => ({
        id: newId(),
        shopId,
        name: `เสื้อยืดล็อตใหญ่หมายเลข${index}`,
        description: 'คำอธิบายสินค้าสำหรับทดสอบ',
        categoryId,
        moderationStatus: 'APPROVED' as const,
        // Unpublished, so all of them match `q` and none of them may be shown (#42).
        shopPublishStatus: 'UNPUBLISHED' as const,
        createdAt: now,
        updatedAt: now,
      })),
    });

    const anon = newClient(app);
    const firstPage = await search(anon, 'เสื้อยืด', { limit: '2' });
    const firstBody = firstPage.body as { items: PublicProductBody[]; nextCursor: string | null; hasMore: boolean };
    expect(firstBody.items).toEqual([]);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await search(anon, 'เสื้อยืด', { limit: '2', cursor: firstBody.nextCursor! });
    const secondBody = secondPage.body as { items: PublicProductBody[]; hasMore: boolean };

    expect(secondBody.items.map((item) => item.id)).toEqual([visible]);
    expect(secondBody.hasMore).toBe(false);
  });

  it('answers 400 for an empty search term', async () => {
    const response = await search(newClient(getApp()), '');

    expect(response.status).toBe(400);
  });
});
