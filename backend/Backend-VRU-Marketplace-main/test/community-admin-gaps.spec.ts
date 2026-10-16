import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, GOOD_PASSWORD, csrfToken, registerAndLogin } from './helpers/auth.js';
import { checkoutAsShown } from './helpers/order.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { beforeNextTransaction } from './helpers/interleave.js';

/**
 * §112 — the gaps a scrutiny of community and admin management found, each settled by the owner:
 * no way for a super admin to find an account's id, nor to see who administers a community, nor
 * for the frontend to know which communities the caller administers; erased and banned admins
 * still counted as the people a community's queue pages; appointing an admin racing the same
 * person opening a shop; duplicate community names; no way to remove a community created by
 * mistake; the appointee never told; and an audit log that cannot be filtered by its subject.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const PERSON = 'person@example.test';
const OTHER = 'other@example.test';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
interface AdminRow {
  userId: string;
  email: string;
  assignedAt: string;
  assignedBy: string;
  bannedAt: string | null;
}
interface UserLookup {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
  bannedAt: string | null;
  adminCommunityIds: string[];
  hasOpenShop: boolean;
}
interface NotificationBody {
  type: string;
  message: string;
  targetType: string | null;
  targetId: string | null;
}
interface AuditRow {
  action: string;
  targetId: string | null;
  communityId: string | null;
}

async function signInAsSuperAdmin(app: TestApp): Promise<Agent> {
  await registerAndLogin(app.client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  return app.client;
}

async function send(client: Agent, method: 'post' | 'patch' | 'delete', path: string, body?: object) {
  return client[method](`${API}${path}`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

async function createCommunity(superAdmin: Agent, name: string) {
  return send(superAdmin, 'post', '/communities', { name, description: 'รายละเอียดสำหรับทดสอบ' });
}

async function communityId(superAdmin: Agent, name: string): Promise<string> {
  return ((await createCommunity(superAdmin, name)).body as { id: string }).id;
}

async function userIdOf(app: TestApp, email: string): Promise<string> {
  return (await app.prisma.user.findUniqueOrThrow({ where: { email } })).id;
}

async function person(app: TestApp, email: string): Promise<{ client: Agent; id: string }> {
  const client = newClient(app);
  await registerVerified(app, client, email);
  return { client, id: await userIdOf(app, email) };
}

async function appoint(superAdmin: Agent, community: string, userId: string) {
  return send(superAdmin, 'post', `/communities/${community}/admins`, { userId });
}

async function noticesOf(client: Agent): Promise<NotificationBody[]> {
  return ((await client.get(`${API}/notifications`)).body as Page<NotificationBody>).items;
}

describe('a super admin finds an account by its exact email (§112)', () => {
  it('answers who the account is, what it administers and whether it runs a shop — any letter case', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const { id } = await person(app, PERSON);
    await appoint(superAdmin, community, id);

    const found = await superAdmin.get(`${API}/admin/users`).query({ email: PERSON.toUpperCase() });

    expect(found.status).toBe(200);
    expect(found.body as UserLookup).toEqual({
      id,
      email: PERSON,
      role: 'USER',
      emailVerified: true,
      bannedAt: null,
      adminCommunityIds: [community],
      hasOpenShop: false,
    });
  });

  it('answers 404 for an address nobody holds, 400 without one, and 403 to anyone but a super admin', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const { client, id } = await person(app, PERSON);
    await appoint(superAdmin, community, id);

    expect((await superAdmin.get(`${API}/admin/users`).query({ email: 'nobody@example.test' })).status).toBe(404);
    expect((await superAdmin.get(`${API}/admin/users`)).status).toBe(400);
    expect((await client.get(`${API}/admin/users`).query({ email: SUPER })).status).toBe(403);
  });
});

describe('who administers a community, and which communities the caller administers (§112)', () => {
  it('lists a community’s admins to a super admin, newest appointment first, with a ban shown', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const first = await person(app, PERSON);
    const second = await person(app, OTHER);
    await appoint(superAdmin, community, first.id);
    await appoint(superAdmin, community, second.id);
    await send(superAdmin, 'post', `/admin/users/${first.id}/ban`, { reason: 'ละเมิดข้อตกลงการใช้งานซ้ำหลายครั้ง' });

    const listed = await superAdmin.get(`${API}/communities/${community}/admins`);

    expect(listed.status).toBe(200);
    const page = listed.body as Page<AdminRow>;
    expect(page.items.map((row) => [row.email, row.bannedAt !== null])).toEqual([
      [OTHER, false],
      [PERSON, true],
    ]);
    expect(page.items[0]!.assignedBy).toBe(await userIdOf(app, SUPER));
    expect(page.hasMore).toBe(false);
  });

  it('refuses the list to a community admin, even of that community, and answers 404 for no such community', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const admin = await person(app, PERSON);
    await appoint(superAdmin, community, admin.id);

    expect((await admin.client.get(`${API}/communities/${community}/admins`)).status).toBe(403);
    expect((await superAdmin.get(`${API}/communities/01900000-0000-7000-8000-000000000000/admins`)).status).toBe(404);
  });

  it('tells the caller on signing in, too', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const admin = await person(app, PERSON);
    await appoint(superAdmin, community, admin.id);

    const signedIn = await send(newClient(app), 'post', '/auth/login', { email: PERSON, password: GOOD_PASSWORD });

    expect((signedIn.body as { adminCommunityIds: string[] }).adminCommunityIds).toEqual([community]);
  });

  it('tells the caller, on GET /auth/me, which communities they administer', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const admin = await person(app, PERSON);
    const plain = await person(app, OTHER);
    await appoint(superAdmin, community, admin.id);

    expect(((await admin.client.get(`${API}/auth/me`)).body as { adminCommunityIds: string[] }).adminCommunityIds).toEqual([community]);
    expect(((await plain.client.get(`${API}/auth/me`)).body as { adminCommunityIds: string[] }).adminCommunityIds).toEqual([]);
  });
});

describe('an admin who is gone no longer counts as one (§112)', () => {
  it('erasing an admin’s account removes them from every community they administered, recorded in audit_log', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const admin = await person(app, PERSON);
    await appoint(superAdmin, community, admin.id);

    expect((await send(admin.client, 'post', '/auth/account/erase')).status).toBe(204);

    expect(((await superAdmin.get(`${API}/communities/${community}/admins`)).body as Page<AdminRow>).items).toEqual([]);
    const audit = ((await superAdmin.get(`${API}/admin/audit-log`).query({ action: 'COMMUNITY_ADMIN_REVOKED' })).body as Page<AuditRow>).items;
    expect(audit).toEqual([expect.objectContaining({ targetId: admin.id, communityId: community })]);
  });

  it('a banned admin is not paged about the community’s queue; the other admin still is', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const banned = await person(app, PERSON);
    const active = await person(app, OTHER);
    await appoint(superAdmin, community, banned.id);
    await appoint(superAdmin, community, active.id);
    await send(superAdmin, 'post', `/admin/users/${banned.id}/ban`, { reason: 'ละเมิดข้อตกลงการใช้งานซ้ำหลายครั้ง' });
    const seller = await person(app, 'seller@example.test');
    const shopId = ((await send(seller.client, 'post', '/shops', { communityId: community, name: 'ร้านทดสอบ' })).body as { id: string }).id;
    await approveShop(app, shopId);
    const categoryId = ((await send(superAdmin, 'post', '/categories', { name: 'เสื้อผ้า' })).body as { id: string }).id;
    const product = (
      await send(seller.client, 'post', '/products', {
        name: 'เสื้อยืด',
        description: 'คำอธิบายสินค้าสำหรับทดสอบ',
        categoryId,
        variants: [{ name: 'สีแดง', priceAmountMinor: 10000, stock: 5 }],
      })
    ).body as { id: string; variants: { id: string }[] };
    await approveProduct(superAdmin, product.id);
    const buyer = await person(app, 'buyer@example.test');
    await send(buyer.client, 'post', '/cart/items', { variantId: product.variants[0]!.id, quantity: 1 });
    const subdistrict = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
    const addressId = (
      (await send(buyer.client, 'post', '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId: subdistrict.id })).body as { id: string }
    ).id;
    expect((await checkoutAsShown(buyer.client, addressId)).status).toBe(201);

    await suspendShop(app, shopId);

    expect((await noticesOf(active.client)).map((n) => n.type)).toContain('ORDER_FROZEN_AWAITING_RULING');
    // A banned account cannot sign in to read its own notifications — the row itself is the evidence.
    expect(await app.prisma.notification.count({ where: { userId: banned.id, type: 'ORDER_FROZEN_AWAITING_RULING' } })).toBe(0);
  });
});

describe('appointing an admin and opening a shop never both land for one person (§112, N29)', () => {
  it('refuses the shop application when the appointment commits while it is in flight', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const applicant = await person(app, PERSON);
    beforeNextTransaction(app, async () => {
      expect((await appoint(superAdmin, community, applicant.id)).status).toBe(201);
    });

    const applied = await send(applicant.client, 'post', '/shops', { communityId: community, name: 'ร้านทดสอบ' });

    expect(applied.status).toBe(403);
    expect(await app.prisma.shop.count({ where: { ownerId: applicant.id } })).toBe(0);
  });

  it('refuses the appointment when the shop application commits while it is in flight', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const applicant = await person(app, PERSON);
    beforeNextTransaction(app, async () => {
      expect((await send(applicant.client, 'post', '/shops', { communityId: community, name: 'ร้านทดสอบ' })).status).toBe(201);
    });

    const appointed = await appoint(superAdmin, community, applicant.id);

    expect(appointed.status).toBe(409);
    expect(await app.prisma.communityAdmin.count({ where: { userId: applicant.id } })).toBe(0);
  });

  it('refuses the appointment when the account’s erasure commits while it is in flight', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const target = await person(app, PERSON);
    beforeNextTransaction(app, async () => {
      expect((await send(target.client, 'post', '/auth/account/erase')).status).toBe(204);
    });

    const appointed = await appoint(superAdmin, community, target.id);

    expect(appointed.status).toBe(404);
    expect(await app.prisma.communityAdmin.count({ where: { userId: target.id } })).toBe(0);
  });

  it('answers 404, not a server error, when the community is removed while an appointment or a shop application is in flight', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const forAdmin = await communityId(superAdmin, 'ชุมชนที่จะลบหนึ่ง');
    const forShop = await communityId(superAdmin, 'ชุมชนที่จะลบสอง');
    const target = await person(app, PERSON);
    const applicant = await person(app, OTHER);
    const removedThen = (community: string) => async () => {
      expect((await send(superAdmin, 'delete', `/communities/${community}`)).status).toBe(204);
    };

    beforeNextTransaction(app, removedThen(forAdmin));
    const appointed = await appoint(superAdmin, forAdmin, target.id);
    beforeNextTransaction(app, removedThen(forShop));
    const applied = await send(applicant.client, 'post', '/shops', { communityId: forShop, name: 'ร้านทดสอบ' });

    expect(appointed.status).toBe(404);
    expect(applied.status).toBe(404);
  });

  it('refuses appointing an erased account or a super admin', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const gone = await person(app, PERSON);
    await send(gone.client, 'post', '/auth/account/erase');

    expect((await appoint(superAdmin, community, gone.id)).status).toBe(404);
    expect((await appoint(superAdmin, community, await userIdOf(app, SUPER))).status).toBe(409);
  });
});

describe('the appointee is told (§112)', () => {
  it('notifies the person when they are made an admin and when that is taken away', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const community = await communityId(superAdmin, 'ชุมชนบางแสน');
    const admin = await person(app, PERSON);

    await appoint(superAdmin, community, admin.id);
    await send(superAdmin, 'delete', `/communities/${community}/admins/${admin.id}`);

    const notices = await noticesOf(admin.client);
    expect(notices.map((n) => n.type).sort()).toEqual(['COMMUNITY_ADMIN_ASSIGNED', 'COMMUNITY_ADMIN_REVOKED']);
    expect(notices.every((n) => n.targetType === 'COMMUNITY' && n.targetId === community && n.message.includes('ชุมชนบางแสน'))).toBe(true);
  });
});

describe('community names and removing a community (§112)', () => {
  it('refuses a second community with the same name, ignoring surrounding spaces and letter case', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    await createCommunity(superAdmin, 'Bang Saen ชุมชน');
    const keep = await communityId(superAdmin, 'ชุมชนศรีราชา');

    const again = await createCommunity(superAdmin, '  bang saen ชุมชน ');
    const renamed = await send(superAdmin, 'patch', `/communities/${keep}`, { name: 'BANG SAEN ชุมชน', description: 'รายละเอียดสำหรับทดสอบ' });
    const sameName = await send(superAdmin, 'patch', `/communities/${keep}`, { name: 'ชุมชนศรีราชา', description: 'รายละเอียดใหม่' });

    expect(again.status).toBe(409);
    expect((again.body as ErrorBody).fieldErrors).toHaveProperty('name');
    expect(renamed.status).toBe(409);
    expect(sameName.status).toBe(200);
  });

  it('lets a super admin remove a community that never had a shop or an admin, recorded in audit_log', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const mistake = await communityId(superAdmin, 'ชุมชนที่สร้างผิด');

    const removed = await send(superAdmin, 'delete', `/communities/${mistake}`);

    expect(removed.status).toBe(204);
    expect(((await app.client.get(`${API}/communities`)).body as Page<{ id: string }>).items.map((c) => c.id)).not.toContain(mistake);
    const audit = ((await superAdmin.get(`${API}/admin/audit-log`).query({ action: 'COMMUNITY_DELETED' })).body as Page<AuditRow>).items;
    expect(audit).toEqual([expect.objectContaining({ targetId: mistake })]);
    expect((await send(superAdmin, 'delete', `/communities/${mistake}`)).status).toBe(404);
  });

  it('refuses removing a community that has an admin or ever had a shop, and refuses anyone but a super admin', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const withAdmin = await communityId(superAdmin, 'ชุมชนมีแอดมิน');
    const withShop = await communityId(superAdmin, 'ชุมชนมีร้าน');
    const admin = await person(app, PERSON);
    await appoint(superAdmin, withAdmin, admin.id);
    const applicant = await person(app, OTHER);
    const shopId = ((await send(applicant.client, 'post', '/shops', { communityId: withShop, name: 'ร้านทดสอบ' })).body as { id: string }).id;
    await send(applicant.client, 'post', `/shops/${shopId}/close`);
    expect(await app.prisma.shop.count({ where: { id: shopId } })).toBe(1);

    expect((await send(admin.client, 'delete', `/communities/${withAdmin}`)).status).toBe(403);
    expect((await send(superAdmin, 'delete', `/communities/${withAdmin}`)).status).toBe(409);
    expect((await send(superAdmin, 'delete', `/communities/${withShop}`)).status).toBe(409);
  });
});

describe('the audit log filters by subject (§112)', () => {
  it('filters by targetId and by communityId', async () => {
    const app = getApp();
    const superAdmin = await signInAsSuperAdmin(app);
    const one = await communityId(superAdmin, 'ชุมชนหนึ่ง');
    const two = await communityId(superAdmin, 'ชุมชนสอง');
    const admin = await person(app, PERSON);
    await appoint(superAdmin, two, admin.id);

    const byTarget = ((await superAdmin.get(`${API}/admin/audit-log`).query({ targetId: one })).body as Page<AuditRow>).items;
    const byCommunity = ((await superAdmin.get(`${API}/admin/audit-log`).query({ communityId: two })).body as Page<AuditRow>).items;

    expect(byTarget.map((row) => row.action)).toEqual(['COMMUNITY_CREATED']);
    expect(byCommunity.map((row) => row.action)).toEqual(['COMMUNITY_ADMIN_ASSIGNED', 'COMMUNITY_CREATED']);
    // Each search is itself recorded, naming what was looked up.
    const views = ((await superAdmin.get(`${API}/admin/audit-log`).query({ action: 'AUDIT_LOG_VIEWED' })).body as Page<AuditRow & { targetType: string; reason: string | null }>).items;
    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetType: 'SYSTEM', reason: `targetId=${one}` }),
        expect.objectContaining({ targetType: 'COMMUNITY', targetId: two }),
      ]),
    );
  });
});
