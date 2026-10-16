import { API } from './helpers/auth.js';
import { newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #46: province → district → subdistrict reference data. Seeded once with the migration (not a
 * separate step anyone could forget), public, read-only, cascades by parent id. These tables are
 * excluded from `truncateAllTables()` — see that helper's comment — so this file arranges nothing
 * beyond reading what the migration already put there.
 */
const getApp = setupTestApp();

interface ProvinceBody {
  id: string;
  nameTh: string;
}
interface DistrictBody {
  id: string;
  nameTh: string;
  provinceId: string;
}
interface SubdistrictBody {
  id: string;
  nameTh: string;
  districtId: string;
  postalCodes: { id: string; postalCode: string }[];
}

describe('the area reference data seeded with the migration (#46)', () => {
  it('has all 77 provinces available without a session', async () => {
    const app = getApp();

    const response = await newClient(app).get(`${API}/provinces`).query({ limit: 50 });

    expect(response.status).toBe(200);
    const body = response.body as { items: ProvinceBody[]; hasMore: boolean };
    expect(body.items.length).toBe(50);
    expect(body.hasMore).toBe(true);

    const total = await app.prisma.province.count();
    expect(total).toBe(77);
  });

  it(
    'lists provinces in source order (กรุงเทพมหานคร first), not reversed by id-descending ' +
      'pagination (§80)',
    async () => {
      const app = getApp();

      const firstPage = await newClient(app).get(`${API}/provinces`).query({ limit: 50 });
      const items = (firstPage.body as { items: ProvinceBody[] }).items;

      expect(items[0]?.nameTh).toBe('กรุงเทพมหานคร');
      expect(items.some((item) => item.nameTh === 'บึงกาฬ')).toBe(false);
    },
  );

  it('pages through all 77 provinces forward, ending with บึงกาฬ (§80)', async () => {
    const app = getApp();
    const client = newClient(app);

    const firstPage = await client.get(`${API}/provinces`).query({ limit: 50 });
    const firstBody = firstPage.body as { items: ProvinceBody[]; hasMore: boolean; nextCursor: string };
    expect(firstBody.hasMore).toBe(true);

    const secondPage = await client
      .get(`${API}/provinces`)
      .query({ limit: 50, cursor: firstBody.nextCursor });
    const secondBody = secondPage.body as { items: ProvinceBody[]; hasMore: boolean };

    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.items.length).toBe(27);
    expect(secondBody.items.at(-1)?.nameTh).toBe('บึงกาฬ');
    // No overlap and no gap between the two pages.
    const allNames = [...firstBody.items, ...secondBody.items].map((item) => item.nameTh);
    expect(new Set(allNames).size).toBe(77);
  });

  it('lists only the districts of the chosen province', async () => {
    const app = getApp();
    const bangkok = await app.prisma.province.findUniqueOrThrow({
      where: { sourceCode: 1 },
    });
    const otherProvince = await app.prisma.province.findUniqueOrThrow({
      where: { sourceCode: 2 },
    });

    const response = await newClient(app)
      .get(`${API}/districts`)
      .query({ provinceId: bangkok.id, limit: 50 });

    expect(response.status).toBe(200);
    const body = response.body as { items: DistrictBody[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.provinceId === bangkok.id)).toBe(true);
    expect(body.items.some((item) => item.provinceId === otherProvince.id)).toBe(false);
  });

  it('answers 400 listing districts with no provinceId', async () => {
    const response = await newClient(getApp()).get(`${API}/districts`);

    expect(response.status).toBe(400);
  });

  it('lists only the subdistricts of the chosen district, each with its postal code(s)', async () => {
    const app = getApp();
    const phraNakhon = await app.prisma.district.findUniqueOrThrow({
      where: { sourceCode: 1001 },
    });

    const response = await newClient(app)
      .get(`${API}/subdistricts`)
      .query({ districtId: phraNakhon.id, limit: 50 });

    expect(response.status).toBe(200);
    const body = response.body as { items: SubdistrictBody[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.districtId === phraNakhon.id)).toBe(true);
    for (const item of body.items) {
      expect(item.postalCodes.length).toBeGreaterThan(0);
      expect(item.postalCodes[0]?.postalCode).toMatch(/^\d{5}$/);
      expect(item.postalCodes[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('cascades correctly end to end: a subdistrict’s postal code matches the real Bangkok 10200 area', async () => {
    const app = getApp();
    const bangkok = await app.prisma.province.findUniqueOrThrow({ where: { sourceCode: 1 } });
    const districts = await newClient(app)
      .get(`${API}/districts`)
      .query({ provinceId: bangkok.id, limit: 50 });
    const phraNakhon = (districts.body as { items: DistrictBody[] }).items.find(
      (item) => item.nameTh === 'เขตพระนคร',
    );
    expect(phraNakhon).toBeDefined();

    const subdistricts = await newClient(app)
      .get(`${API}/subdistricts`)
      .query({ districtId: phraNakhon?.id, limit: 50 });
    const wangBurapha = (subdistricts.body as { items: SubdistrictBody[] }).items.find(
      (item) => item.nameTh === 'วังบูรพาภิรมย์',
    );

    expect(wangBurapha?.postalCodes.map((row) => row.postalCode)).toEqual(['10200']);
  });
});
