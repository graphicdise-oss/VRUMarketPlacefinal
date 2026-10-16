import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #33: reading `audit_log` — closes the loop #15 opened by writing a table nothing could read.
 * Super admin only, not one of the six things a community admin may do (invariant 1), filterable
 * by actor and by action, newest first, `{ items, nextCursor, hasMore }` (M3).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN = 'admin@example.test';
const BUYER = 'buyer@example.test';

interface AuditLogEntryBody {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  communityId: string | null;
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<string> {
  const session = await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });

  return (session.body as { id: string }).id;
}

async function createCommunity(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin
    .post(`${API}/communities`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name, description: 'รายละเอียดสำหรับทดสอบ' });

  return (response.body as { id: string }).id;
}

describe('who may read audit_log (#33)', () => {
  it('lets a super admin read it', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const response = await superAdmin.get(`${API}/admin/audit-log`);

    expect(response.status).toBe(200);
    const body = response.body as {
      items: AuditLogEntryBody[];
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.action).toBe('COMMUNITY_CREATED');
    // #33's code review (2026-09-22): COMMUNITY_CREATED's communityId is the community itself.
    expect(body.items[0]?.communityId).toBe(body.items[0]?.targetId);
    expect(body).toHaveProperty('nextCursor');
    expect(body).toHaveProperty('hasMore');
  });

  it('refuses an ordinary signed-in user', async () => {
    const app = getApp();
    await signInAsSuperAdmin(app, app.client);

    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await buyer.get(`${API}/admin/audit-log`);

    expect(response.status).toBe(403);
  });

  it('refuses somebody not signed in at all', async () => {
    const response = await newClient(getApp()).get(`${API}/admin/audit-log`);

    expect(response.status).toBe(401);
  });

  it(
    'refuses a real community admin too — reading audit_log is not one of the six things ' +
      'invariant 1 grants, not even for their own community',
    async () => {
      const app = getApp();
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

      const admin = newClient(app);
      const adminSession = await registerAndLogin(admin, ADMIN);
      const adminId = (adminSession.body as { id: string }).id;
      await superAdmin
        .post(`${API}/communities/${communityId}/admins`)
        .set(CSRF_HEADER, await csrfToken(superAdmin))
        .send({ userId: adminId });

      const response = await admin.get(`${API}/admin/audit-log`);

      expect(response.status).toBe(403);
    },
  );
});

describe('filtering and ordering', () => {
  it('filters by actor', async () => {
    const app = getApp();
    const superAdmin = app.client;
    const superAdminId = await signInAsSuperAdmin(app, superAdmin);
    await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const response = await superAdmin.get(`${API}/admin/audit-log`).query({
      actorUserId: superAdminId,
    });

    expect(response.status).toBe(200);
    const body = response.body as { items: AuditLogEntryBody[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((entry) => entry.actorUserId === superAdminId)).toBe(true);
  });

  it('filters by action', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const admin = newClient(app);
    const adminSession = await registerAndLogin(admin, ADMIN);
    const adminId = (adminSession.body as { id: string }).id;
    await superAdmin
      .post(`${API}/communities/${communityId}/admins`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ userId: adminId });

    const response = await superAdmin.get(`${API}/admin/audit-log`).query({
      action: 'COMMUNITY_ADMIN_ASSIGNED',
    });

    expect(response.status).toBe(200);
    const body = response.body as { items: AuditLogEntryBody[] };
    expect(body.items.length).toBe(1);
    expect(body.items[0]?.action).toBe('COMMUNITY_ADMIN_ASSIGNED');
  });

  it('rejects an action outside the closed vocabulary with 400, not a query that matches nothing', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const response = await superAdmin
      .get(`${API}/admin/audit-log`)
      .query({ action: 'NOT_A_REAL_ACTION' });

    expect(response.status).toBe(400);
  });

  it('lists newest first', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    await createCommunity(superAdmin, 'ชุมชนบางแสน');
    await createCommunity(superAdmin, 'ชุมชนศรีราชา');

    const response = await superAdmin.get(`${API}/admin/audit-log`);

    const body = response.body as { items: AuditLogEntryBody[] };
    const ids = body.items.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});

describe('reading the log with a filter is itself recorded (#33 code review, 2026-09-22)', () => {
  it('does not record anything when opening the log with no filter at all', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const before = await app.prisma.auditLog.count({ where: { action: 'AUDIT_LOG_VIEWED' } });
    const response = await superAdmin.get(`${API}/admin/audit-log`);
    const after = await app.prisma.auditLog.count({ where: { action: 'AUDIT_LOG_VIEWED' } });

    expect(response.status).toBe(200);
    expect(after).toBe(before);
  });

  it('records AUDIT_LOG_VIEWED, targeting the person searched, when filtering by actor', async () => {
    const app = getApp();
    const superAdmin = app.client;
    const superAdminId = await signInAsSuperAdmin(app, superAdmin);
    await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const response = await superAdmin
      .get(`${API}/admin/audit-log`)
      .query({ actorUserId: superAdminId });

    expect(response.status).toBe(200);
    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'AUDIT_LOG_VIEWED' },
      orderBy: { id: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorUserId).toBe(superAdminId);
    expect(entry?.targetType).toBe('USER');
    expect(entry?.targetId).toBe(superAdminId);
  });

  it('records AUDIT_LOG_VIEWED against SYSTEM when filtering by action alone', async () => {
    const app = getApp();
    const superAdmin = app.client;
    const superAdminId = await signInAsSuperAdmin(app, superAdmin);
    await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const response = await superAdmin
      .get(`${API}/admin/audit-log`)
      .query({ action: 'COMMUNITY_CREATED' });

    expect(response.status).toBe(200);
    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'AUDIT_LOG_VIEWED' },
      orderBy: { id: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorUserId).toBe(superAdminId);
    expect(entry?.targetType).toBe('SYSTEM');
    expect(entry?.targetId).toBeNull();
  });

  it('records only once per search, not once per page turned with a cursor', async () => {
    const app = getApp();
    const superAdmin = app.client;
    const superAdminId = await signInAsSuperAdmin(app, superAdmin);
    for (let index = 0; index < 3; index += 1) {
      // Sequential and awaited, same reasoning as community.spec.ts: each row needs the previous
      // one's id already assigned for UUIDv7 ordering to be meaningful.

      await createCommunity(superAdmin, `ชุมชนทดสอบที่ ${index}`);
    }

    const firstPage = await superAdmin
      .get(`${API}/admin/audit-log`)
      .query({ actorUserId: superAdminId, limit: 1 });
    expect(firstPage.status).toBe(200);
    const cursor = (firstPage.body as { nextCursor: string | null }).nextCursor;
    expect(cursor).not.toBeNull();

    const secondPage = await superAdmin
      .get(`${API}/admin/audit-log`)
      .query({ actorUserId: superAdminId, limit: 1, cursor });
    expect(secondPage.status).toBe(200);

    const viewedCount = await app.prisma.auditLog.count({
      where: { action: 'AUDIT_LOG_VIEWED', actorUserId: superAdminId },
    });
    expect(viewedCount).toBe(1);
  });
});

describe('no way to edit or delete', () => {
  it('has no route at all for anything but GET', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const patch = await superAdmin
      .patch(`${API}/admin/audit-log`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({});
    const del = await superAdmin
      .delete(`${API}/admin/audit-log`)
      .set(CSRF_HEADER, await csrfToken(superAdmin));

    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
  });
});
