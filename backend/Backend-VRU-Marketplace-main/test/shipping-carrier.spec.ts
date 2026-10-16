import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #58 (F1/K9/L5): the platform's set of couriers a shop picks from when shipping — a table, not
 * an enum, copied field-for-field from `CategoryService`'s own shape (#40).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const BUYER = 'buyer@example.test';

interface CarrierBody {
  id: string;
  name: string;
  isOther: boolean;
  isActive: boolean;
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function create(client: Agent, name: string) {
  return client
    .post(`${API}/shipping-carriers`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ name });
}

async function update(client: Agent, id: string, name: string, isActive: boolean) {
  return client
    .patch(`${API}/shipping-carriers/${id}`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ name, isActive });
}

describe('reading shipping carriers needs no session (L5)', () => {
  it('lets an anonymous caller list carriers', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    await create(superAdmin, 'Kerry');

    const response = await newClient(app).get(`${API}/shipping-carriers`);

    expect(response.status).toBe(200);
    const body = response.body as { items: CarrierBody[] };
    expect(body.items.some((item) => item.name === 'Kerry')).toBe(true);
  });

  it('excludes a retired carrier by default, but includes it with includeInactive=true', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const created = await create(superAdmin, 'Kerry');
    const carrierId = (created.body as CarrierBody).id;
    await update(superAdmin, carrierId, 'Kerry', false);

    const defaultList = await newClient(app).get(`${API}/shipping-carriers`);
    expect((defaultList.body as { items: CarrierBody[] }).items.some((item) => item.id === carrierId)).toBe(false);

    const withInactive = await newClient(app).get(`${API}/shipping-carriers`).query({ includeInactive: 'true' });
    const found = (withInactive.body as { items: CarrierBody[] }).items.find((item) => item.id === carrierId);
    expect(found?.isActive).toBe(false);
  });
});

describe('who may add or edit a shipping carrier — super admin only, same as categories', () => {
  it('lets a super admin create one, recorded in audit_log, never marked isOther', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const response = await create(superAdmin, 'Kerry');

    expect(response.status).toBe(201);
    const body = response.body as CarrierBody;
    expect(body.name).toBe('Kerry');
    expect(body.isActive).toBe(true);
    expect(body.isOther).toBe(false);

    const entry = await app.prisma.auditLog.findFirst({ where: { action: 'SHIPPING_CARRIER_CREATED', targetId: body.id } });
    expect(entry).not.toBeNull();
  });

  it('rejects a create call that tries to smuggle isOther in — the field is not on the DTO at all', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const response = await superAdmin
      .post(`${API}/shipping-carriers`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ name: 'Kerry', isOther: true });

    expect(response.status).toBe(400);
  });

  it('refuses an ordinary signed-in user', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await create(buyer, 'Kerry');

    expect(response.status).toBe(403);
  });

  it('refuses somebody not signed in at all', async () => {
    const response = await create(newClient(getApp()), 'Kerry');

    expect(response.status).toBe(401);
  });

  it('renames and retires a carrier in one PATCH, recorded in audit_log', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const created = await create(superAdmin, 'Kerry');
    const carrierId = (created.body as CarrierBody).id;

    const response = await update(superAdmin, carrierId, 'Kerry Express', false);

    expect(response.status).toBe(200);
    const body = response.body as CarrierBody;
    expect(body.name).toBe('Kerry Express');
    expect(body.isActive).toBe(false);

    const entry = await app.prisma.auditLog.findFirst({ where: { action: 'SHIPPING_CARRIER_UPDATED', targetId: carrierId } });
    expect(entry).not.toBeNull();
  });

  it('answers 404 editing a carrier that does not exist', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const response = await update(superAdmin, newId(), 'Kerry', true);

    expect(response.status).toBe(404);
  });

  it('answers 409 creating a carrier whose name already exists', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    await create(superAdmin, 'Kerry');

    const response = await create(superAdmin, 'Kerry');

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });
});
