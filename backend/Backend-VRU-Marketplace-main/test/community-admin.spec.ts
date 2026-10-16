import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #31: `CommunityAdmin` itself — super admin sets and revokes it, and revoking bites on the very
 * next request because nothing here caches the answer (invariant 7, same as a ban).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SOMCHAI = 'somchai@example.test';
const MALEE = 'malee@example.test';

interface CommunityAdminBody {
  id: string;
  userId: string;
  communityId: string;
  assignedBy: string;
  assignedAt: string;
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

async function assign(client: Agent, communityId: string, userId: string) {
  return client
    .post(`${API}/communities/${communityId}/admins`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ userId });
}

async function revoke(client: Agent, communityId: string, userId: string) {
  return client
    .delete(`${API}/communities/${communityId}/admins/${userId}`)
    .set(CSRF_HEADER, await csrfToken(client));
}

describe('who may assign or revoke a community admin (A2)', () => {
  it('lets a super admin assign one, recorded in audit_log', async () => {
    const app = getApp();
    const superAdmin = app.client;
    const superAdminId = await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;

    const response = await assign(superAdmin, communityId, somchaiId);

    expect(response.status).toBe(201);
    const body = response.body as CommunityAdminBody;
    expect(body.userId).toBe(somchaiId);
    expect(body.communityId).toBe(communityId);

    // Targets the person, not the grant row: the grant row is deleted on revoke, and an audit
    // entry pointing at a deleted row answers nothing.
    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'COMMUNITY_ADMIN_ASSIGNED', targetId: somchaiId },
    });
    expect(entry).not.toBeNull();
    expect(entry?.targetType).toBe('COMMUNITY_ADMIN');
    expect(entry?.actorUserId).toBe(superAdminId);
    // #33's code review (2026-09-22): the community this grant covers has to be recoverable from
    // the log even after the community_admin row is deleted by a later revoke.
    expect(entry?.communityId).toBe(communityId);
  });

  it('refuses an ordinary signed-in user trying to assign', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;

    const response = await assign(somchai, communityId, somchaiId);

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('FORBIDDEN');
  });

  it('refuses an ordinary signed-in user trying to revoke', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;
    await assign(superAdmin, communityId, somchaiId);

    // Malee is nobody in particular — not a super admin, not an admin of anything.
    const malee = newClient(app);
    await registerAndLogin(malee, MALEE);

    const response = await revoke(malee, communityId, somchaiId);

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('FORBIDDEN');
    await expect(
      app.prisma.communityAdmin.findUnique({
        where: { userId_communityId: { userId: somchaiId, communityId } },
      }),
    ).resolves.not.toBeNull();
  });

  it('refuses somebody not signed in at all', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const response = await assign(newClient(app), communityId, newId());

    expect(response.status).toBe(401);
  });

  it('refuses a community admin trying to appoint a peer — the whole point of A2', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;
    await assign(superAdmin, communityId, somchaiId);

    const malee = newClient(app);
    const maleeSession = await registerAndLogin(malee, MALEE);
    const maleeId = (maleeSession.body as { id: string }).id;

    // Somchai is now a real admin of this community, and tries to appoint Malee himself.
    const response = await assign(somchai, communityId, maleeId);

    expect(response.status).toBe(403);
    await expect(
      app.prisma.communityAdmin.findUnique({
        where: { userId_communityId: { userId: maleeId, communityId } },
      }),
    ).resolves.toBeNull();
  });

  it('refuses a community admin trying to revoke anyone', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;
    await assign(superAdmin, communityId, somchaiId);

    const malee = newClient(app);
    const maleeSession = await registerAndLogin(malee, MALEE);
    const maleeId = (maleeSession.body as { id: string }).id;
    await assign(superAdmin, communityId, maleeId);

    // Somchai, a real admin here, tries to revoke Malee's admin rights.
    const response = await revoke(somchai, communityId, maleeId);

    expect(response.status).toBe(403);
    await expect(
      app.prisma.communityAdmin.findUnique({
        where: { userId_communityId: { userId: maleeId, communityId } },
      }),
    ).resolves.not.toBeNull();
  });

  it('answers 404 assigning against a community that does not exist', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;

    const response = await assign(superAdmin, newId(), somchaiId);

    expect(response.status).toBe(404);
  });

  it('answers 404 assigning a user that does not exist', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const response = await assign(superAdmin, communityId, newId());

    expect(response.status).toBe(404);
  });
});

describe('one CommunityAdmin row per (user, community) pair', () => {
  it('lets one person administer two different communities', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityA = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;

    const first = await assign(superAdmin, communityA, somchaiId);
    const second = await assign(superAdmin, communityB, somchaiId);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    await expect(app.prisma.communityAdmin.count({ where: { userId: somchaiId } })).resolves.toBe(
      2,
    );
  });

  it('does not create a duplicate row assigning the same person to the same community twice', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;

    const first = await assign(superAdmin, communityId, somchaiId);
    const second = await assign(superAdmin, communityId, somchaiId);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect((second.body as ErrorBody).code).toBe('CONFLICT');

    await expect(
      app.prisma.communityAdmin.count({ where: { userId: somchaiId, communityId } }),
    ).resolves.toBe(1);
  });

  // The other way a second row could appear is two assigns racing past the existence check at
  // once. The service maps the resulting P2002 back to the same 409, but there is no test for it
  // here: seam 1 boots the HTTP server per request (supertest does the listen), so two requests
  // fired together fight over the listener and one gets ECONNREFUSED before it reaches Nest.
  // Proving that branch needs the shared helper to hold the server open, which is #14's file and
  // every other spec's behaviour — flagged rather than changed from this ticket.
});

/**
 * Invariant 7 here means "the row is the only copy of the answer" — revoking deletes it, and
 * nothing caches it in a token or a session. A test that watches a revoked admin *get refused*
 * needs something that reads this table, which is #32's two-tier guard; until then what is
 * provable is that the row is gone the instant the call returns.
 */
describe('revoking a community admin leaves nothing behind that could answer stale (invariant 7)', () => {
  it('lets a super admin revoke, recorded in audit_log, and deletes the row', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;
    await assign(superAdmin, communityId, somchaiId);

    const response = await revoke(superAdmin, communityId, somchaiId);

    expect(response.status).toBe(204);

    await expect(
      app.prisma.communityAdmin.findUnique({
        where: { userId_communityId: { userId: somchaiId, communityId } },
      }),
    ).resolves.toBeNull();

    // Both halves of the episode survive the row they describe: the grant row is gone, the
    // person both entries point at is not. Targeting the join row would have orphaned both.
    const entries = await app.prisma.auditLog.findMany({
      where: { targetType: 'COMMUNITY_ADMIN', targetId: somchaiId },
      orderBy: { id: 'asc' },
    });
    expect(entries.map((entry) => entry.action)).toEqual([
      'COMMUNITY_ADMIN_ASSIGNED',
      'COMMUNITY_ADMIN_REVOKED',
    ]);
    // Both entries still answer "which community", even though the community_admin row that
    // named the pair is gone by the time the second one is written.
    expect(entries.every((entry) => entry.communityId === communityId)).toBe(true);
    await expect(
      app.prisma.user.findUnique({ where: { id: somchaiId }, select: { id: true } }),
    ).resolves.not.toBeNull();
  });

  it('answers 409 revoking somebody who is not an admin of that community', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;

    const response = await revoke(superAdmin, communityId, somchaiId);

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).code).toBe('CONFLICT');
  });
});

describe('a banned account can still be assigned, but the global guard still refuses every request', () => {
  it('assigns a banned user without error, and their next request is still ACCOUNT_BANNED', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;
    await superAdmin.post(`${API}/admin/users/${somchaiId}/ban`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ reason: 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง' }).expect(204);

    const response = await assign(superAdmin, communityId, somchaiId);
    expect(response.status).toBe(201);

    // The row exists, but the banned account still cannot reach anything at all — the two-tier
    // guard of #32 never even gets asked, because AuthGuard refuses first.
    const me = await somchai.get(`${API}/auth/me`);
    expect(me.status).toBe(403);
    expect((me.body as ErrorBody).code).toBe('ACCOUNT_BANNED');
  });
});

describe('a community admin still cannot touch user data — that stays super-admin-only', () => {
  it('gets 403 trying to ban another user, even after being made a community admin', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const somchai = newClient(app);
    const somchaiSession = await registerAndLogin(somchai, SOMCHAI);
    const somchaiId = (somchaiSession.body as { id: string }).id;
    await assign(superAdmin, communityId, somchaiId);

    const malee = newClient(app);
    const maleeSession = await registerAndLogin(malee, MALEE);
    const maleeId = (maleeSession.body as { id: string }).id;

    const response = await somchai
      .post(`${API}/admin/users/${maleeId}/ban`)
      .set(CSRF_HEADER, await csrfToken(somchai))
      .send({ reason: 'ทดสอบ' });

    expect(response.status).toBe(403);
  });
});
