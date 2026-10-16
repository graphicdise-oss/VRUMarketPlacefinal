import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #40: the platform's one flat set of product categories — a table, not an enum (L5), single
 * level (K6), super-admin-owned, retired with `isActive` rather than deleted.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN = 'admin@example.test';
const BUYER = 'buyer@example.test';

interface CategoryBody {
  id: string;
  name: string;
  isActive: boolean;
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function create(client: Agent, name: string) {
  return client
    .post(`${API}/categories`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ name });
}

async function update(client: Agent, id: string, name: string, isActive: boolean) {
  return client
    .patch(`${API}/categories/${id}`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ name, isActive });
}

describe('reading categories needs no session (K6 · L5)', () => {
  it('lets an anonymous caller list categories', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    await create(superAdmin, 'ของเล่นเด็ก');

    const response = await newClient(app).get(`${API}/categories`);

    expect(response.status).toBe(200);
    const body = response.body as { items: CategoryBody[] };
    expect(body.items.some((item) => item.name === 'ของเล่นเด็ก')).toBe(true);
  });

  it('excludes a retired category by default, but includes it with includeInactive=true', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const created = await create(superAdmin, 'ของเล่นเด็ก');
    const categoryId = (created.body as CategoryBody).id;
    await update(superAdmin, categoryId, 'ของเล่นเด็ก', false);

    const defaultList = await newClient(app).get(`${API}/categories`);
    expect(
      (defaultList.body as { items: CategoryBody[] }).items.some((item) => item.id === categoryId),
    ).toBe(false);

    const withInactive = await newClient(app)
      .get(`${API}/categories`)
      .query({ includeInactive: 'true' });
    const found = (withInactive.body as { items: CategoryBody[] }).items.find(
      (item) => item.id === categoryId,
    );
    expect(found?.isActive).toBe(false);
  });
});

describe('who may add or edit a category — super admin only (C2)', () => {
  it('lets a super admin create one, recorded in audit_log', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const response = await create(superAdmin, 'ของเล่นเด็ก');

    expect(response.status).toBe(201);
    const body = response.body as CategoryBody;
    expect(body.name).toBe('ของเล่นเด็ก');
    expect(body.isActive).toBe(true);

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'CATEGORY_CREATED', targetId: body.id },
    });
    expect(entry).not.toBeNull();
  });

  it('refuses an ordinary signed-in user', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await create(buyer, 'ของเล่นเด็ก');

    expect(response.status).toBe(403);
  });

  it('refuses somebody not signed in at all', async () => {
    const response = await create(newClient(getApp()), 'ของเล่นเด็ก');

    expect(response.status).toBe(401);
  });

  it('refuses a community admin — editing categories is not one of the six things invariant 1 grants', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const communityResponse = await superAdmin
      .post(`${API}/communities`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' });
    const communityId = (communityResponse.body as { id: string }).id;

    const admin = newClient(app);
    const adminSession = await registerAndLogin(admin, ADMIN);
    const adminId = (adminSession.body as { id: string }).id;
    await superAdmin
      .post(`${API}/communities/${communityId}/admins`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ userId: adminId });

    const response = await create(admin, 'ของเล่นเด็ก');

    expect(response.status).toBe(403);
  });

  it('renames and retires a category in one PATCH, recorded in audit_log', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const created = await create(superAdmin, 'ของเล่นเด็ก');
    const categoryId = (created.body as CategoryBody).id;

    const response = await update(superAdmin, categoryId, 'ของเล่นและเกม', false);

    expect(response.status).toBe(200);
    const body = response.body as CategoryBody;
    expect(body.name).toBe('ของเล่นและเกม');
    expect(body.isActive).toBe(false);

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'CATEGORY_UPDATED', targetId: categoryId },
    });
    expect(entry).not.toBeNull();
  });

  it('answers 404 editing a category that does not exist', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const response = await update(superAdmin, newId(), 'ของเล่นเด็ก', true);

    expect(response.status).toBe(404);
  });

  it('answers 409 creating a category whose name already exists', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    await create(superAdmin, 'ของเล่นเด็ก');

    const response = await create(superAdmin, 'ของเล่นเด็ก');

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });

  it('answers 409 renaming a category to a name another category already uses', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    await create(superAdmin, 'ของเล่นเด็ก');
    const second = await create(superAdmin, 'เครื่องเขียน');

    const response = await update(
      superAdmin,
      (second.body as CategoryBody).id,
      'ของเล่นเด็ก',
      true,
    );

    expect(response.status).toBe(409);
  });
});

describe('retiring a category does not delete it — old references stay valid', () => {
  it('leaves the row and its id resolvable after retiring', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const created = await create(superAdmin, 'ของเล่นเด็ก');
    const categoryId = (created.body as CategoryBody).id;

    await update(superAdmin, categoryId, 'ของเล่นเด็ก', false);

    const row = await app.prisma.category.findUnique({ where: { id: categoryId } });
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(false);
  });
});
