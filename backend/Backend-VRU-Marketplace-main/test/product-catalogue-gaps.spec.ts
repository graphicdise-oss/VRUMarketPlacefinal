import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §110 (the products + search scrutiny, the owner's decisions):
 * - a price above ฿20 million (the order ceiling) or stock above 1,000,000 is a validation error, not a 500;
 * - the product list and search filter by category;
 * - search reaches a product's name, its options' names and its shop's name (typo-tolerant), and its
 *   description (exact substring only) — still newest first;
 * - one product cannot carry two options with the same name.
 * Every search term here is real Thai (CLAUDE.md: English passes where Thai breaks).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';

async function post(client: Agent, path: string, body: object) {
  return client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

async function marketplace(app: TestApp) {
  const superAdmin = app.client;
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  const communityA = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const communityB = ((await post(superAdmin, '/communities', { name: 'ชุมชนอ่างศิลา', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const clothes = ((await post(superAdmin, '/categories', { name: 'เสื้อผ้า' })).body as { id: string }).id;
  const snacks = ((await post(superAdmin, '/categories', { name: 'ขนมไทย' })).body as { id: string }).id;
  const seller = newClient(app);
  await registerVerified(app, seller, 'seller@example.test');
  const shopId = ((await post(seller, '/shops', { communityId: communityA, name: 'ร้านผ้าทอมือป้าแดง' })).body as { id: string }).id;
  await approveShop(app, shopId);

  return { superAdmin, seller, shopId, communityA, communityB, clothes, snacks };
}

interface Variant {
  name: string;
  priceAmountMinor?: number;
  stock?: number;
}

async function create(seller: Agent, categoryId: string, name: string, variants: Variant[] = [{ name: 'แบบเดียว' }], description = 'สินค้าคุณภาพดีจากชุมชน') {
  return post(seller, '/products', {
    name,
    description,
    categoryId,
    variants: variants.map((variant) => ({ priceAmountMinor: 10000, stock: 5, ...variant })),
  });
}

async function listed(superAdmin: Agent, seller: Agent, categoryId: string, name: string, variants?: Variant[], description?: string): Promise<{ id: string; variants: { id: string; name: string }[] }> {
  const created = await create(seller, categoryId, name, variants, description);
  expect(created.status).toBe(201);
  const product = created.body as { id: string; variants: { id: string; name: string }[] };
  expect((await approveProduct(superAdmin, product.id)).status).toBe(200);
  return product;
}

/** Which fields a validation error names — the key a form highlights. */
function fieldsIn(body: unknown): string[] {
  return Object.keys((body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {});
}

async function searchNames(term: string, extra: Record<string, string> = {}): Promise<string[]> {
  const response = await newClient(getApp()).get(`${API}/products/search`).query({ q: term, ...extra });
  expect(response.status).toBe(200);
  return (response.body as { items: { name: string }[] }).items.map((item) => item.name);
}

describe('§110 — price and stock ceilings answer 400, never 500', () => {
  it('a price above ฿20 million or stock above 1,000,000 is refused with a field error; the ceilings themselves are accepted', async () => {
    const app = getApp();
    const { seller, clothes } = await marketplace(app);

    const tooExpensive = await create(seller, clothes, 'ผ้าไหมราคาเกิน', [{ name: 'ผืนเดียว', priceAmountMinor: 2_000_000_001 }]);
    expect(tooExpensive.status).toBe(400);
    expect(tooExpensive.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fieldsIn(tooExpensive.body)).toContain('variants.0.priceAmountMinor');
    expect((await create(seller, clothes, 'ผ้าไหมสต็อกเกิน', [{ name: 'ผืนเดียว', stock: 1_000_001 }])).status).toBe(400);
    expect((await create(seller, clothes, 'ผ้าไหมเพดานพอดี', [{ name: 'ผืนเดียว', priceAmountMinor: 2_000_000_000, stock: 1_000_000 }])).status).toBe(201);
  });

  it('editing an option past the ceiling is refused too, and a decision carrying an impossible revision is a 400', async () => {
    const app = getApp();
    const { superAdmin, seller, clothes } = await marketplace(app);
    const product = (await create(seller, clothes, 'เสื้อยืดสีขาว')).body as { id: string; variants: { id: string }[] };

    const edited = await seller
      .patch(`${API}/products/${product.id}/variants/${product.variants[0]!.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'แบบเดียว', priceAmountMinor: 9_000_000_000, stock: 5, expectedStock: 5 });
    expect(edited.status).toBe(400);

    expect((await post(superAdmin, `/products/${product.id}/approve`, { reviewRevision: 3_000_000_000 })).status).toBe(400);
  });
});

describe('§110 — the list and search filter by category', () => {
  it('categoryId narrows the product list and a search, alone or with communityId', async () => {
    const app = getApp();
    const { superAdmin, seller, communityA, communityB, clothes, snacks } = await marketplace(app);
    await listed(superAdmin, seller, clothes, 'เสื้อผ้าฝ้ายย้อมคราม');
    await listed(superAdmin, seller, snacks, 'ขนมผ้าพับ');

    const byCategory = (await newClient(app).get(`${API}/products`).query({ categoryId: snacks })).body as { items: { name: string }[] };
    expect(byCategory.items.map((item) => item.name)).toEqual(['ขนมผ้าพับ']);
    expect(await searchNames('ผ้า', { categoryId: clothes })).toEqual(['เสื้อผ้าฝ้ายย้อมคราม']);
    expect(await searchNames('ผ้า', { categoryId: clothes, communityId: communityA })).toEqual(['เสื้อผ้าฝ้ายย้อมคราม']);
    expect(await searchNames('ผ้า', { categoryId: clothes, communityId: communityB })).toEqual([]);
  });
});

describe('§110 — search reaches options, the shop and the description', () => {
  it('finds a product by one of its options’ names, typo included — but not by an option that was deleted', async () => {
    const app = getApp();
    const { superAdmin, seller, clothes } = await marketplace(app);
    const product = await listed(superAdmin, seller, clothes, 'เสื้อยืดคอกลม', [{ name: 'สีน้ำเงินกรมท่า' }, { name: 'สีเหลืองมัสตาร์ด' }]);

    expect(await searchNames('น้ำเงินกรมท่า')).toEqual(['เสื้อยืดคอกลม']);
    expect(await searchNames('น้ำเงินกรมทา')).toEqual(['เสื้อยืดคอกลม']); // dropped tone mark

    const mustard = product.variants.find((variant) => variant.name === 'สีเหลืองมัสตาร์ด')!;
    expect((await seller.delete(`${API}/products/${product.id}/variants/${mustard.id}`).set(CSRF_HEADER, await csrfToken(seller))).status).toBe(200);
    expect(await searchNames('เหลืองมัสตาร์ด')).toEqual([]);
  });

  it('finds a shop’s products by the shop’s name', async () => {
    const app = getApp();
    const { superAdmin, seller, clothes } = await marketplace(app);
    await listed(superAdmin, seller, clothes, 'ผ้าขาวม้าลายตาราง');

    expect(await searchNames('ป้าแดง')).toEqual(['ผ้าขาวม้าลายตาราง']);
    expect(await searchNames('ผ้าทอมือปาแดง')).toEqual(['ผ้าขาวม้าลายตาราง']); // dropped tone mark
  });

  it('a suspended shop’s products are not found through its name or its options’ names', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, clothes } = await marketplace(app);
    await listed(superAdmin, seller, clothes, 'ผ้าซิ่นตีนจก', [{ name: 'ลายนกยูงทอง' }]);
    await suspendShop(app, shopId);

    expect(await searchNames('ป้าแดง')).toEqual([]);
    expect(await searchNames('นกยูงทอง')).toEqual([]);
  });

  it('finds a product by a phrase in its description, but only as written — no typo tolerance there', async () => {
    const app = getApp();
    const { superAdmin, seller, clothes } = await marketplace(app);
    await listed(superAdmin, seller, clothes, 'ผ้าคลุมไหล่', undefined, 'ทอด้วยมือจากไหมอีรี่ของกลุ่มแม่บ้านบ้านนาเกลือ');

    expect(await searchNames('ไหมอีรี่')).toEqual(['ผ้าคลุมไหล่']);
    expect(await searchNames('ไหมอีลี่')).toEqual([]); // ร → ล: a typo, not a substring
  });

  it('a hidden product is not found through any of the new routes either', async () => {
    const app = getApp();
    const { seller, clothes } = await marketplace(app);
    // Never approved: its option name, shop name and description all match, and none may surface it.
    expect((await create(seller, clothes, 'กระเป๋าสาน', [{ name: 'สีน้ำตาลกาแฟ' }], 'สานจากกระจูดแท้')).status).toBe(201);

    expect(await searchNames('น้ำตาลกาแฟ')).toEqual([]);
    expect(await searchNames('ป้าแดง')).toEqual([]);
    expect(await searchNames('กระจูดแท้')).toEqual([]);
  });

  it('results stay newest first whichever field matched', async () => {
    const app = getApp();
    const { superAdmin, seller, clothes } = await marketplace(app);
    // The older product matches only through its description, the newer through its name.
    await listed(superAdmin, seller, clothes, 'หมอนอิงผ้าฝ้าย', undefined, 'ยัดใยสังเคราะห์ หุ้มผ้าลายไทย');
    await listed(superAdmin, seller, clothes, 'ผ้าลายไทยผืนใหญ่');

    expect(await searchNames('ลายไทย')).toEqual(['ผ้าลายไทยผืนใหญ่', 'หมอนอิงผ้าฝ้าย']);
  });
});

describe('§110 — one product cannot carry two options with the same name', () => {
  it('refuses duplicates on create, on adding an option, and on renaming one — other products may reuse the name', async () => {
    const app = getApp();
    const { seller, clothes } = await marketplace(app);

    const duplicated = await create(seller, clothes, 'เสื้อโปโล', [{ name: 'สีแดง' }, { name: ' สีแดง ' }]);
    expect(duplicated.status).toBe(400);
    expect(duplicated.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fieldsIn(duplicated.body)).toEqual(['variants']);
    // Case does not make a different option either (Latin sizes are common: "Free size" / "free size").
    expect((await create(seller, clothes, 'เสื้อโปโล', [{ name: 'Free size' }, { name: 'free SIZE' }])).status).toBe(400);

    const product = (await create(seller, clothes, 'เสื้อโปโล', [{ name: 'สีแดง' }, { name: 'สีดำ' }])).body as { id: string; variants: { id: string; name: string }[] };
    const added = await post(seller, `/products/${product.id}/variants`, { name: 'สีแดง', priceAmountMinor: 10000, stock: 1 });
    expect(added.status).toBe(400);
    expect(fieldsIn(added.body)).toEqual(['name']);
    const black = product.variants.find((variant) => variant.name === 'สีดำ')!;
    const renamed = await seller
      .patch(`${API}/products/${product.id}/variants/${black.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'สีแดง', priceAmountMinor: 10000, stock: 5, expectedStock: 5 });
    expect(renamed.status).toBe(400);

    expect((await create(seller, clothes, 'เสื้อเชิ้ต', [{ name: 'สีแดง' }])).status).toBe(201);
  });

  it('a deleted option’s name is free again', async () => {
    const app = getApp();
    const { seller, clothes } = await marketplace(app);
    const product = (await create(seller, clothes, 'กางเกงเล', [{ name: 'สีครีม' }, { name: 'สีเทา' }])).body as { id: string; variants: { id: string; name: string }[] };
    const cream = product.variants.find((variant) => variant.name === 'สีครีม')!;
    expect((await seller.delete(`${API}/products/${product.id}/variants/${cream.id}`).set(CSRF_HEADER, await csrfToken(seller))).status).toBe(200);

    expect((await post(seller, `/products/${product.id}/variants`, { name: 'สีครีม', priceAmountMinor: 12000, stock: 2 })).status).toBe(201);
  });
});
