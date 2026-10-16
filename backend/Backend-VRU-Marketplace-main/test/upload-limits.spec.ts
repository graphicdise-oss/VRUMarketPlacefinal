import './helpers/tight-upload-limits.js';
import { readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CookieAccessInfo } from 'cookiejar';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { newId } from '../src/common/id.js';
import { registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §100: uploads must not be a way to take the server down (found in §99 — twelve simultaneous
 * large uploads from a fresh account with no orders got the API killed for memory).
 *
 * This file runs with the ceilings squeezed (`helpers/tight-upload-limits.ts`): one image processed
 * at a time with no waiting for a turn, and three uploads an hour per account.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';

async function signInAsSuperAdmin(app: TestApp): Promise<Agent> {
  const superAdmin = newClient(app);
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  return superAdmin;
}

async function communityOf(superAdmin: Agent): Promise<string> {
  const response = await superAdmin
    .post(`${API}/communities`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name: 'ชุมชนทดสอบอัปโหลด', description: 'รายละเอียดสำหรับทดสอบ' });
  return (response.body as { id: string }).id;
}

/** A signed-in account with a shop of its own (applied, not yet approved — a logo is allowed then). */
async function shopOwner(app: TestApp, communityId: string, email: string): Promise<Agent> {
  const owner = newClient(app);
  await registerVerified(app, owner, email);
  const shop = await owner.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(owner)).send({ communityId, name: `ร้าน ${email}` });
  expect(shop.status).toBe(201);
  return owner;
}

/** Noise does not compress, so this is close to the test ceiling (1MB) and takes real work to re-encode. */
async function noisyPng(): Promise<Buffer> {
  const side = 560;
  const pixels = Buffer.alloc(side * side * 3);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = (i * 2654435761) % 251;
  }
  return sharp(pixels, { raw: { width: side, height: side, channels: 3 } }).png().toBuffer();
}

async function uploadLogo(owner: Agent, png: Buffer): Promise<{ status: number; code?: string; retryAfter?: string }> {
  const response = await owner.post(`${API}/shops/me/logo`).set(CSRF_HEADER, await csrfToken(owner)).attach('file', png, 'logo.png');
  return {
    status: response.status,
    code: (response.body as { code?: string }).code,
    retryAfter: response.headers['retry-after'],
  };
}

/**
 * Starts a multipart upload that announces 5MB and sends only its first 64KB, then waits for an
 * answer. A server that reads the whole body before deciding can only answer once the rest arrives —
 * which it never does — so getting an answer at all proves the decision came first.
 */
async function answerBeforeTheBodyArrives(app: TestApp, agent: Agent, path: string, field: string): Promise<{ status: number; code?: string } | 'no answer'> {
  const cookie = agent.jar.getCookies(new CookieAccessInfo('127.0.0.1', '/api/v1', false)).toValueString();
  const csrf = await csrfToken(agent);
  const boundary = 'vru-upload-test-boundary';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="big.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);

  return new Promise((resolve) => {
    const request = httpRequest(`${app.baseUrl}${API}${path}`, {
      method: 'POST',
      headers: {
        cookie,
        [CSRF_HEADER]: csrf,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(5 * 1024 * 1024),
      },
    });
    const timer = setTimeout(() => {
      request.destroy();
      resolve('no answer');
    }, 3000);
    request.on('response', (response) => {
      let text = '';
      response.on('data', (chunk: Buffer) => (text += chunk.toString()));
      response.on('end', () => {
        clearTimeout(timer);
        request.destroy();
        resolve({ status: response.statusCode ?? 0, code: (JSON.parse(text || '{}') as { code?: string }).code });
      });
    });
    request.on('error', () => undefined);
    request.write(head);
    request.write(Buffer.alloc(64 * 1024, 0xff));
  });
}

describe('§100 — an upload the caller could never make is refused before its body is read', () => {
  const routes: [label: string, path: () => string, field: string][] = [
    ['dispute evidence, buyer', () => `/orders/${newId()}/dispute`, 'files'],
    ['dispute evidence, shop', () => `/shops/me/orders/${newId()}/dispute/respond`, 'files'],
    ['payment slip', () => `/orders/${newId()}/payment-slips`, 'file'],
    ['refund slip', () => `/shops/me/orders/${newId()}/refund-slips`, 'file'],
    ['review photo', () => `/orders/${newId()}/review/images`, 'file'],
    ['chat photo', () => `/chat-rooms/${newId()}/attachments`, 'file'],
    ['payment QR', () => `/shops/me/payment-channels/${newId()}/qr-image`, 'file'],
    ['shop logo (no shop)', () => '/shops/me/logo', 'file'],
    ['product photo', () => `/products/${newId()}/images`, 'file'],
  ];

  it.each(routes)('%s: 404 while the upload is still arriving', async (label, path, field) => {
    const app = getApp();
    const caller = newClient(app);
    await registerVerified(app, caller, `nobody-${label.replace(/\W+/g, '-').toLowerCase()}@example.test`);

    expect(await answerBeforeTheBodyArrives(app, caller, path(), field)).toEqual({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('§100 — the pre-check does not turn a malformed id into a server error', () => {
  it('a route id that is not a UUID is answered 400, as it was before the check ran ahead of validation', async () => {
    const app = getApp();
    const caller = newClient(app);
    await registerVerified(app, caller, 'malformed@example.test');

    expect(await answerBeforeTheBodyArrives(app, caller, '/orders/not-a-uuid/payment-slips', 'file')).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });
});

describe('§100 — uploads are counted per account, not per address', () => {
  it('the fourth upload in an hour is refused with Retry-After; another account is not; the hour reopens it', async () => {
    const app = getApp();
    const communityId = await communityOf(await signInAsSuperAdmin(app));
    const [first, second] = [await shopOwner(app, communityId, 'first@example.test'), await shopOwner(app, communityId, 'second@example.test')];
    const png = await noisyPng();

    for (let i = 0; i < 3; i += 1) {
      expect((await uploadLogo(first, png)).status).toBe(200);
    }
    const refused = await uploadLogo(first, png);
    expect(refused).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(Number(refused.retryAfter)).toBeGreaterThan(0);

    // Same address (every test client is 127.0.0.1) — a campus behind one router is not one person.
    expect((await uploadLogo(second, png)).status).toBe(200);

    app.clock.advanceByMinutes(61);
    // The access token lives 15 minutes; a browser refreshes it the same way.
    expect((await first.post(`${API}/auth/refresh`).set(CSRF_HEADER, await csrfToken(first))).status).toBe(204);
    expect((await uploadLogo(first, png)).status).toBe(200);
  });
});

describe('§100 — image processing has a ceiling, and the overflow is told to come back', () => {
  it('uploads arriving while the one processing slot is taken get 503 with Retry-After; the rest are stored', async () => {
    const app = getApp();
    const communityId = await communityOf(await signInAsSuperAdmin(app));
    const owners: Agent[] = [];
    for (let i = 0; i < 8; i += 1) {
      owners.push(await shopOwner(app, communityId, `owner-${i}@example.test`));
    }
    const png = await noisyPng();

    const outcomes = await Promise.all(owners.map((owner) => uploadLogo(owner, png)));

    const busy = outcomes.filter((outcome) => outcome.status === 503);
    expect(busy.length).toBeGreaterThan(0);
    for (const outcome of busy) {
      expect(outcome.code).toBe('SERVICE_UNAVAILABLE');
      expect(Number(outcome.retryAfter)).toBeGreaterThan(0);
    }
    expect(outcomes.filter((outcome) => outcome.status !== 503).every((outcome) => outcome.status === 200)).toBe(true);
  });
});

describe('§100 — an upload is held on disk only while its request lasts', () => {
  it('the scratch directory is empty again after an upload that is stored and one that is refused', async () => {
    const app = getApp();
    const communityId = await communityOf(await signInAsSuperAdmin(app));
    const owner = await shopOwner(app, communityId, 'owner@example.test');

    expect((await uploadLogo(owner, await noisyPng())).status).toBe(200);
    expect((await uploadLogo(owner, Buffer.from('this is not an image at all'))).status).toBe(400);

    // The scratch directory is not reachable over HTTP by design (uploads are only ever served
    // through the endpoints that check permission) — read it directly. Deleted as the response
    // closes, so polled rather than read once.
    let left: string[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      left = await readdir(process.env.UPLOAD_TMP_DIR!).catch(() => []);
      if (left.length === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(left).toEqual([]);
  });
});
