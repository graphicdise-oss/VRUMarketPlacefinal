import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { beforeNextTransaction } from './helpers/interleave.js';

/**
 * §113 — the gaps a scrutiny of addresses and notifications found: no ceiling on how many
 * addresses one account can save (the owner chose 10, like Shopee); an address deleted while
 * another request on it was in flight could still be edited or made the default, leaving the
 * account's live addresses with no default; "mark all read" clearing notices that arrived after
 * the person last looked; and the notification and unread-count responses documented as empty
 * objects in the generated API docs.
 */
const getApp = setupTestApp();

const BUYER = 'buyer@example.test';
const SUPER = 'superadmin@example.test';

interface AddressBody {
  id: string;
  isDefault: boolean;
}
interface NotificationBody {
  id: string;
  type: string;
  readAt: string | null;
}

async function postalCodeId(app: TestApp): Promise<string> {
  return (await app.prisma.subdistrictPostalCode.findFirstOrThrow()).id;
}

function payload(subdistrictPostalCodeId: string, houseNumber: string) {
  return { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber, subdistrictPostalCodeId };
}

async function saveAddress(app: TestApp, client: Agent, houseNumber: string) {
  return client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send(payload(await postalCodeId(app), houseNumber));
}

async function liveAddresses(app: TestApp, userId: string) {
  return app.prisma.address.findMany({ where: { userId, deletedAt: null }, select: { id: true, isDefault: true } });
}

describe('§113 — at most 10 saved addresses per account', () => {
  it('refuses the 11th live address with 409, and a deleted one frees its place', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const saved: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const response = await saveAddress(app, buyer, String(i));
      expect(response.status).toBe(201);
      saved.push((response.body as AddressBody).id);
    }

    const eleventh = await saveAddress(app, buyer, '11');

    expect(eleventh.status).toBe(409);
    expect((eleventh.body as ErrorBody).code).toBe('CONFLICT');
    expect((eleventh.body as ErrorBody).message).toContain('10');

    await buyer.delete(`${API}/addresses/${saved[3]!}`).set(CSRF_HEADER, await csrfToken(buyer)).send();
    expect((await saveAddress(app, buyer, '11')).status).toBe(201);
  });
});

describe('§113 — an address deleted mid-request stays deleted, and the account keeps a default', () => {
  it('making an address the default while it is being deleted answers 404 and leaves the other one default', async () => {
    const app = getApp();
    const buyer = newClient(app);
    const userId = ((await registerAndLogin(buyer, BUYER)).body as { id: string }).id;
    const first = ((await saveAddress(app, buyer, '1')).body as AddressBody).id;
    const second = ((await saveAddress(app, buyer, '2')).body as AddressBody).id;
    const token = await csrfToken(buyer);
    let removed = 0;
    beforeNextTransaction(app, async () => {
      removed = (await buyer.delete(`${API}/addresses/${second}`).set(CSRF_HEADER, token).send()).status;
    });

    const response = await buyer.post(`${API}/addresses/${second}/default`).set(CSRF_HEADER, token).send();

    expect(removed).toBe(204);
    expect(response.status).toBe(404);
    expect(await liveAddresses(app, userId)).toEqual([{ id: first, isDefault: true }]);
  });

  it('editing an address while it is being deleted answers 404', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const only = ((await saveAddress(app, buyer, '1')).body as AddressBody).id;
    const token = await csrfToken(buyer);
    let removed = 0;
    beforeNextTransaction(app, async () => {
      removed = (await buyer.delete(`${API}/addresses/${only}`).set(CSRF_HEADER, token).send()).status;
    });

    const response = await buyer
      .patch(`${API}/addresses/${only}`)
      .set(CSRF_HEADER, token)
      .send(payload(await postalCodeId(app), '99'));

    expect(removed).toBe(204);
    expect(response.status).toBe(404);
  });

  it('a new address saved while the default is being deleted becomes the default', async () => {
    const app = getApp();
    const buyer = newClient(app);
    const userId = ((await registerAndLogin(buyer, BUYER)).body as { id: string }).id;
    const old = ((await saveAddress(app, buyer, '1')).body as AddressBody).id;
    const token = await csrfToken(buyer);
    beforeNextTransaction(app, async () => {
      await buyer.delete(`${API}/addresses/${old}`).set(CSRF_HEADER, token).send();
    });

    const created = await saveAddress(app, buyer, '2');

    expect(created.status).toBe(201);
    expect((created.body as AddressBody).isDefault).toBe(true);
    expect(await liveAddresses(app, userId)).toEqual([{ id: (created.body as AddressBody).id, isDefault: true }]);
  });
});

describe('§113 — "mark all read" only clears what the person has seen', () => {
  /** Three notices for `person`, oldest first: appointed, removed, appointed again (§112). */
  async function threeNotices(app: TestApp): Promise<{ person: Agent; ids: string[] }> {
    await registerAndLogin(app.client, SUPER);
    // No endpoint makes a super admin, by design — the one column CLAUDE.md lets a test set.
    await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
    const superAdmin = app.client;
    const community = ((await superAdmin
      .post(`${API}/communities`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ name: 'ชุมชนหนองมน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
    const person = newClient(app);
    const personId = ((await registerAndLogin(person, BUYER)).body as { id: string }).id;
    const token = await csrfToken(superAdmin);
    await superAdmin.post(`${API}/communities/${community}/admins`).set(CSRF_HEADER, token).send({ userId: personId });
    await superAdmin.delete(`${API}/communities/${community}/admins/${personId}`).set(CSRF_HEADER, token).send();
    await superAdmin.post(`${API}/communities/${community}/admins`).set(CSRF_HEADER, token).send({ userId: personId });
    const items = ((await person.get(`${API}/notifications`)).body as { items: NotificationBody[] }).items;
    expect(items).toHaveLength(3);

    return { person, ids: items.map((n) => n.id).reverse() };
  }

  it('with upToId, a notice newer than the one shown stays unread', async () => {
    const app = getApp();
    const { person, ids } = await threeNotices(app);

    const response = await person
      .post(`${API}/notifications/read-all`)
      .set(CSRF_HEADER, await csrfToken(person))
      .send({ upToId: ids[1] });

    expect(response.status).toBe(204);
    const items = ((await person.get(`${API}/notifications`)).body as { items: NotificationBody[] }).items;
    expect(items.map((n) => [n.id, n.readAt !== null])).toEqual([
      [ids[2], false],
      [ids[1], true],
      [ids[0], true],
    ]);
    expect(((await person.get(`${API}/notifications/unread-count`)).body as { count: number }).count).toBe(1);
  });

  it('without upToId, every notice is read as before', async () => {
    const app = getApp();
    const { person } = await threeNotices(app);

    expect((await person.post(`${API}/notifications/read-all`).set(CSRF_HEADER, await csrfToken(person)).send()).status).toBe(204);

    expect(((await person.get(`${API}/notifications/unread-count`)).body as { count: number }).count).toBe(0);
  });

  it('refuses an upToId that is not a uuid', async () => {
    const app = getApp();
    const person = newClient(app);
    await registerAndLogin(person, BUYER);

    const response = await person
      .post(`${API}/notifications/read-all`)
      .set(CSRF_HEADER, await csrfToken(person))
      .send({ upToId: 'latest' });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).fieldErrors).toHaveProperty('upToId');
  });
});

describe('§113 — the generated API docs describe these responses', () => {
  it('NotificationDto and UnreadCountDto have their fields, and saving an address documents 400 and 409, not 404', async () => {
    const app = getApp();

    const document = (await newClient(app).get('/api/v1/docs-json')).body as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };

    expect(Object.keys(document.components.schemas.NotificationDto!.properties ?? {})).toEqual(
      expect.arrayContaining(['id', 'type', 'message', 'targetType', 'targetId', 'createdAt', 'readAt']),
    );
    expect(Object.keys(document.components.schemas.UnreadCountDto!.properties ?? {})).toEqual(['count']);
    expect(Object.keys(document.paths['/api/v1/addresses']!.post!.responses).sort()).toEqual(['201', '400', '409']);
  });
});
