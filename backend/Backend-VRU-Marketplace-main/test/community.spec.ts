import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { encodeCursor } from '../src/common/pagination/cursor.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #30: `Community` itself, and the first real list endpoint in the system — the ticket that
 * proves #18's cursor envelope over HTTP (M3), which nothing before topic 3 had a route to prove.
 */
const getApp = setupTestApp();

const ADMIN = 'superadmin@example.test';
const SOMCHAI = 'somchai@example.test';

interface CommunityBody {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

interface CommunityPage {
  items: CommunityBody[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The role is set directly, because the only thing that creates the first super admin is the
 * seed script K2 describes, and building that script is not part of this ticket's acceptance
 * criteria (see the report for #30). Everything this test then *asserts* goes through HTTP.
 */
async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, ADMIN);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: ADMIN }, data: { role: 'SUPER_ADMIN' } });
}

async function createCommunity(
  client: Agent,
  name: string,
  description = 'รายละเอียดของชุมชนสำหรับทดสอบ',
) {
  return client
    .post(`${API}/communities`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ name, description });
}

describe('who may create or edit a community (A2)', () => {
  it('lets a super admin create one, recorded in audit_log', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);

    const response = await createCommunity(admin, 'ชุมชนบางแสน');

    expect(response.status).toBe(201);
    const body = response.body as CommunityBody;
    expect(body.name).toBe('ชุมชนบางแสน');
    expect(body.id).toBeDefined();

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'COMMUNITY_CREATED', targetId: body.id },
    });
    expect(entry).not.toBeNull();
    expect(entry?.targetType).toBe('COMMUNITY');
    // #33's code review (2026-09-22): the community a COMMUNITY_CREATED/UPDATED entry is about
    // is the row itself — the one case where targetId and communityId are the same value.
    expect(entry?.communityId).toBe(body.id);
  });

  it('refuses an ordinary signed-in user', async () => {
    const app = getApp();
    await registerAndLogin(app.client, SOMCHAI);

    const response = await createCommunity(app.client, 'ชุมชนที่ไม่ควรเกิดขึ้น');

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('FORBIDDEN');
  });

  it('refuses somebody who is not signed in at all', async () => {
    const app = getApp();

    const response = await createCommunity(newClient(app), 'ชุมชนที่ไม่ควรเกิดขึ้น');

    expect(response.status).toBe(401);
  });

  it('rejects a blank name, naming the field, instead of writing a row', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);

    const response = await createCommunity(admin, '');

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).fieldErrors?.name).toBeDefined();
    await expect(app.prisma.community.count()).resolves.toBe(0);
  });

  it('lets a super admin edit a community, recorded in audit_log', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);
    const created = await createCommunity(admin, 'ชื่อเดิม');
    const id = (created.body as CommunityBody).id;

    const response = await admin
      .patch(`${API}/communities/${id}`)
      .set(CSRF_HEADER, await csrfToken(admin))
      .send({ name: 'ชื่อใหม่', description: 'รายละเอียดใหม่' });

    expect(response.status).toBe(200);
    expect((response.body as CommunityBody).name).toBe('ชื่อใหม่');
    expect((response.body as CommunityBody).description).toBe('รายละเอียดใหม่');

    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'COMMUNITY_UPDATED', targetId: id },
    });
    expect(entry).not.toBeNull();
    expect(entry?.communityId).toBe(id);
  });

  it('refuses an ordinary user trying to edit', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);
    const created = await createCommunity(admin, 'ชื่อเดิม');
    const id = (created.body as CommunityBody).id;

    const somchai = newClient(app);
    await registerAndLogin(somchai, SOMCHAI);

    const response = await somchai
      .patch(`${API}/communities/${id}`)
      .set(CSRF_HEADER, await csrfToken(somchai))
      .send({ name: 'ชื่อใหม่', description: 'รายละเอียดใหม่' });

    expect(response.status).toBe(403);
  });

  it('answers 404 editing a community that does not exist, not a crash', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);

    const response = await admin
      .patch(`${API}/communities/${newId()}`)
      .set(CSRF_HEADER, await csrfToken(admin))
      .send({ name: 'ชื่อใหม่', description: 'รายละเอียดใหม่' });

    expect(response.status).toBe(404);
  });
});

describe('listing communities — public, no session required (invariant 1)', () => {
  it('lets an anonymous caller see the list', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);
    await createCommunity(admin, 'ชุมชนบางแสน');

    const response = await newClient(app).get(`${API}/communities`);

    expect(response.status).toBe(200);
    const page = response.body as CommunityPage;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.name).toBe('ชุมชนบางแสน');
  });

  it('has exactly the envelope from #18 — no total and no page number (M3)', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);
    await createCommunity(admin, 'ชุมชนบางแสน');

    const response = await newClient(app).get(`${API}/communities`);

    expect(Object.keys(response.body as object).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
  });

  it('pages through every community exactly once, newest first, using real cursors over HTTP', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);

    for (let index = 0; index < 25; index += 1) {
      // Sequential and awaited: UUIDv7 ordering (what makes newest-first free) depends on each
      // row's id being generated after the previous one.
       
      await createCommunity(admin, `ชุมชนทดสอบที่ ${index}`);
    }

    const anonymous = newClient(app);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const query: Record<string, string | number> = { limit: 10 };
      if (cursor !== undefined) {
        query.cursor = cursor;
      }

       
      const response = await anonymous.get(`${API}/communities`).query(query);
      expect(response.status).toBe(200);

      const page = response.body as CommunityPage;
      seen.push(...page.items.map((item) => item.id));
      pages += 1;

      if (!page.hasMore) {
        break;
      }
      cursor = page.nextCursor ?? undefined;
      expect(pages).toBeLessThan(10);
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    // Newest first, which UUIDv7 gives for free (no secondary sort column, see cursor.ts).
    expect([...seen].sort().reverse()).toEqual(seen);
  });

  it('clamps a page size above the maximum instead of rejecting (I17)', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);
    for (let index = 0; index < 3; index += 1) {
       
      await createCommunity(admin, `ชุมชน ${index}`);
    }

    const response = await newClient(app).get(`${API}/communities`).query({ limit: 999 });

    expect(response.status).toBe(200);
    expect((response.body as CommunityPage).items).toHaveLength(3);
  });

  it('rejects a mangled cursor as a validation failure, not a 500', async () => {
    const app = getApp();

    const response = await newClient(app)
      .get(`${API}/communities`)
      .query({ cursor: 'not-a-real-cursor' });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_FAILED');
    expect((response.body as ErrorBody).fieldErrors?.cursor).toBeDefined();
  });

  it('rejects a cursor issued for a different list rather than returning nonsense', async () => {
    const app = getApp();
    const admin = app.client;
    await signInAsSuperAdmin(app, admin);
    await createCommunity(admin, 'ชุมชนบางแสน');

    // Same codec a real list uses, exactly as a cursor copy-pasted from another screen would look.
    const foreign = encodeCursor({ list: 'audit', id: newId() });

    const response = await newClient(app).get(`${API}/communities`).query({ cursor: foreign });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_FAILED');
  });
});
