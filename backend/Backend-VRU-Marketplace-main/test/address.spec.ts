import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #47: a buyer's saved delivery addresses — several per person, one default enforced at the
 * database, soft delete, standard fields referencing #46's subdistrict/postal-code table by a
 * real foreign key rather than free text, and the privacy ACs (nobody reads or edits another
 * person's address).
 */
const getApp = setupTestApp();

const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'other-buyer@example.test';

interface AddressBody {
  id: string;
  recipientName: string;
  phone: string;
  houseNumber: string;
  villageNumber: string | null;
  alley: string | null;
  road: string | null;
  subdistrictPostalCodeId: string;
  postalCode: string;
  subdistrictId: string;
  isDefault: boolean;
}

/** A real row from #46's reference tables — every test needs one to build a valid address. */
async function aRealSubdistrictPostalCodeId(app: TestApp): Promise<string> {
  const row = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  return row.id;
}

function validPayload(subdistrictPostalCodeId: string, overrides: Record<string, unknown> = {}) {
  return {
    recipientName: 'สมชาย ใจดี',
    phone: '0812345678',
    houseNumber: '99/9',
    subdistrictPostalCodeId,
    ...overrides,
  };
}

async function create(client: Agent, payload: Record<string, unknown>) {
  return client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send(payload);
}

async function update(client: Agent, id: string, payload: Record<string, unknown>) {
  return client
    .patch(`${API}/addresses/${id}`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send(payload);
}

async function setDefault(client: Agent, id: string) {
  return client.post(`${API}/addresses/${id}/default`).set(CSRF_HEADER, await csrfToken(client)).send();
}

async function remove(client: Agent, id: string) {
  return client.delete(`${API}/addresses/${id}`).set(CSRF_HEADER, await csrfToken(client)).send();
}

describe('saving an address (#47)', () => {
  it('requires a session', async () => {
    const app = getApp();
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);

    const response = await newClient(app)
      .post(`${API}/addresses`)
      .send(validPayload(postalCodeId));

    expect(response.status).toBe(401);
  });

  it('becomes the caller’s default automatically as their first address', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);

    const response = await create(buyer, validPayload(postalCodeId));

    expect(response.status).toBe(201);
    const body = response.body as AddressBody;
    expect(body.isDefault).toBe(true);
    expect(body.subdistrictPostalCodeId).toBe(postalCodeId);
    expect(body.postalCode).toMatch(/^\d{5}$/);
  });

  it('does not make a second address the default automatically', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);

    await create(buyer, validPayload(postalCodeId));
    const second = await create(buyer, validPayload(postalCodeId, { houseNumber: '1' }));

    expect(second.status).toBe(201);
    expect((second.body as AddressBody).isDefault).toBe(false);
  });

  it(
    'rejects a subdistrictPostalCodeId that is not a real row as a validation error, not a ' +
      '404 on a route that exists (§80)',
    async () => {
      const app = getApp();
      const buyer = newClient(app);
      await registerAndLogin(buyer, BUYER);

      const response = await create(buyer, validPayload('01923abc-0000-7000-8000-000000000000'));

      expect(response.status).toBe(400);
      const body = response.body as ErrorBody;
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.fieldErrors?.subdistrictPostalCodeId).toBeDefined();
    },
  );

  it('rejects a malformed phone number', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);

    const response = await create(buyer, validPayload(postalCodeId, { phone: 'not-a-phone' }));

    expect(response.status).toBe(400);
  });

  it(
    'stores a blank optional field as null, not as an empty string that would outlive the ' +
      'buyer editing it away (§80)',
    async () => {
      const app = getApp();
      const buyer = newClient(app);
      await registerAndLogin(buyer, BUYER);
      const postalCodeId = await aRealSubdistrictPostalCodeId(app);

      const response = await create(
        buyer,
        validPayload(postalCodeId, { villageNumber: '', alley: '   ', road: undefined }),
      );

      expect(response.status).toBe(201);
      const body = response.body as AddressBody;
      expect(body.villageNumber).toBeNull();
      expect(body.alley).toBeNull();
      expect(body.road).toBeNull();
    },
  );
});

describe('listing my addresses', () => {
  it('shows only the caller’s own, not another buyer’s', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    await create(buyer, validPayload(postalCodeId));

    const otherBuyer = newClient(app);
    await registerAndLogin(otherBuyer, OTHER_BUYER);
    await create(otherBuyer, validPayload(postalCodeId));

    const response = await buyer.get(`${API}/addresses`);

    expect(response.status).toBe(200);
    const body = response.body as { items: AddressBody[] };
    expect(body.items.length).toBe(1);
  });

  it('excludes a deleted address', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const created = await create(buyer, validPayload(postalCodeId));
    const addressId = (created.body as AddressBody).id;

    await remove(buyer, addressId);
    const response = await buyer.get(`${API}/addresses`);

    expect((response.body as { items: AddressBody[] }).items).toEqual([]);
  });
});

describe('privacy — buyer ก. cannot read, edit, delete, or set-default buyer ข.’s address (AC)', () => {
  it('answers 404 for view, edit, delete, and set-default across accounts', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const created = await create(buyer, validPayload(postalCodeId));
    const addressId = (created.body as AddressBody).id;

    const otherBuyer = newClient(app);
    await registerAndLogin(otherBuyer, OTHER_BUYER);

    const view = await otherBuyer.get(`${API}/addresses/${addressId}`);
    const edit = await update(otherBuyer, addressId, validPayload(postalCodeId, { houseNumber: '2' }));
    const setDefaultResponse = await setDefault(otherBuyer, addressId);
    const del = await remove(otherBuyer, addressId);

    expect(view.status).toBe(404);
    expect(edit.status).toBe(404);
    expect(setDefaultResponse.status).toBe(404);
    expect(del.status).toBe(404);

    // Untouched by any of the other account's attempts.
    const stillMine = await buyer.get(`${API}/addresses/${addressId}`);
    expect(stillMine.status).toBe(200);
  });
});

describe('editing an address', () => {
  it('replaces every field (full PATCH, same shape as creation)', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const created = await create(buyer, validPayload(postalCodeId));
    const addressId = (created.body as AddressBody).id;

    const response = await update(
      buyer,
      addressId,
      validPayload(postalCodeId, { recipientName: 'สมหญิง ใจดี', houseNumber: '42' }),
    );

    expect(response.status).toBe(200);
    const body = response.body as AddressBody;
    expect(body.recipientName).toBe('สมหญิง ใจดี');
    expect(body.houseNumber).toBe('42');
  });

  it('rejects editing to a subdistrictPostalCodeId that does not exist, as a validation error (§80)', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const created = await create(buyer, validPayload(postalCodeId));
    const addressId = (created.body as AddressBody).id;

    const response = await update(
      buyer,
      addressId,
      validPayload('01923abc-0000-7000-8000-000000000000'),
    );

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_FAILED');
  });
});

describe('one default address at a time (spec 6/12 AC)', () => {
  it('unsets the previous default when a new one is chosen', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const first = await create(buyer, validPayload(postalCodeId));
    const second = await create(buyer, validPayload(postalCodeId, { houseNumber: '1' }));
    const firstId = (first.body as AddressBody).id;
    const secondId = (second.body as AddressBody).id;

    const response = await setDefault(buyer, secondId);

    expect(response.status).toBe(200);
    expect((response.body as AddressBody).isDefault).toBe(true);

    const firstNow = await buyer.get(`${API}/addresses/${firstId}`);
    expect((firstNow.body as AddressBody).isDefault).toBe(false);
  });

  it(
    'enforces exactly one live default at the database — two addresses racing to become ' +
      'default produce exactly one winner',
    async () => {
      const app = getApp();
      const buyer = newClient(app);
      const session = await registerAndLogin(buyer, BUYER);
      const buyerId = (session.body as { id: string }).id;
      const postalCodeId = await aRealSubdistrictPostalCodeId(app);
      const first = await create(buyer, validPayload(postalCodeId));
      const second = await create(buyer, validPayload(postalCodeId, { houseNumber: '1' }));
      const firstId = (first.body as AddressBody).id;
      const secondId = (second.body as AddressBody).id;
      // Fetched once and reused on both concurrent requests — see shop.spec.ts's identical
      // comment on why a fresh token per call would race the two calls against each other.
      const token = await csrfToken(buyer);

      const [a, b] = await Promise.all([
        buyer.post(`${API}/addresses/${firstId}/default`).set(CSRF_HEADER, token).send(),
        buyer.post(`${API}/addresses/${secondId}/default`).set(CSRF_HEADER, token).send(),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 200]);
      await expect(
        app.prisma.address.count({ where: { userId: buyerId, isDefault: true, deletedAt: null } }),
      ).resolves.toBe(1);
    },
  );

  it('setting default on the address that already is one is idempotent, not an error', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const created = await create(buyer, validPayload(postalCodeId));
    const addressId = (created.body as AddressBody).id;

    const response = await setDefault(buyer, addressId);

    expect(response.status).toBe(200);
    expect((response.body as AddressBody).isDefault).toBe(true);
  });
});

describe('deleting an address (soft delete, spec 6/12)', () => {
  it('answers 404 for the address afterwards, but the row survives in the database', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const created = await create(buyer, validPayload(postalCodeId));
    const addressId = (created.body as AddressBody).id;

    const response = await remove(buyer, addressId);
    expect(response.status).toBe(204);

    const afterwards = await buyer.get(`${API}/addresses/${addressId}`);
    expect(afterwards.status).toBe(404);

    await expect(app.prisma.address.findUniqueOrThrow({ where: { id: addressId } })).resolves.toMatchObject(
      { id: addressId },
    );
  });

  it('answers 404 deleting an address that does not exist', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);

    const response = await remove(buyer, '01923abc-0000-7000-8000-000000000000');

    expect(response.status).toBe(404);
    expect((response.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it(
    'promotes another live address to default when the default one is deleted, so a buyer ' +
      'with addresses left is never left with none marked default (§80)',
    async () => {
      const app = getApp();
      const buyer = newClient(app);
      const session = await registerAndLogin(buyer, BUYER);
      const buyerId = (session.body as { id: string }).id;
      const postalCodeId = await aRealSubdistrictPostalCodeId(app);
      const first = await create(buyer, validPayload(postalCodeId));
      const second = await create(buyer, validPayload(postalCodeId, { houseNumber: '1' }));
      const firstId = (first.body as AddressBody).id;
      const secondId = (second.body as AddressBody).id;
      expect((first.body as AddressBody).isDefault).toBe(true);

      const response = await remove(buyer, firstId);
      expect(response.status).toBe(204);

      const secondNow = await buyer.get(`${API}/addresses/${secondId}`);
      expect((secondNow.body as AddressBody).isDefault).toBe(true);
      await expect(
        app.prisma.address.count({ where: { userId: buyerId, isDefault: true, deletedAt: null } }),
      ).resolves.toBe(1);
    },
  );

  it('deleting a non-default address leaves the existing default untouched (§80)', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const first = await create(buyer, validPayload(postalCodeId));
    const second = await create(buyer, validPayload(postalCodeId, { houseNumber: '1' }));
    const firstId = (first.body as AddressBody).id;
    const secondId = (second.body as AddressBody).id;

    await remove(buyer, secondId);

    const firstNow = await buyer.get(`${API}/addresses/${firstId}`);
    expect((firstNow.body as AddressBody).isDefault).toBe(true);
  });

  it('deleting the only address leaves no default to promote (§80)', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, BUYER);
    const postalCodeId = await aRealSubdistrictPostalCodeId(app);
    const created = await create(buyer, validPayload(postalCodeId));
    const addressId = (created.body as AddressBody).id;

    const response = await remove(buyer, addressId);

    expect(response.status).toBe(204);
  });
});
