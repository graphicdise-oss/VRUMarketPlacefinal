import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §100, with the ceilings as they ship: image processing is limited to a few at a time, but an
 * upload that arrives while every slot is taken waits for one (up to the queue timeout) rather
 * than being refused — a busy moment makes uploads slower, not fail.
 */
const getApp = setupTestApp();

describe('§100 — at the shipped settings, a burst of uploads waits its turn and every one is stored', () => {
  it('eight simultaneous uploads all succeed', async () => {
    const app = getApp();
    const superAdmin = newClient(app);
    await registerAndLogin(superAdmin, 'superadmin@example.test');
    // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
    await app.prisma.user.update({ where: { email: 'superadmin@example.test' }, data: { role: 'SUPER_ADMIN' } });
    const community = await superAdmin
      .post(`${API}/communities`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ name: 'ชุมชนทดสอบคิว', description: 'รายละเอียดสำหรับทดสอบ' });
    const communityId = (community.body as { id: string }).id;

    const owners: Agent[] = [];
    for (let i = 0; i < 8; i += 1) {
      const owner = newClient(app);
      await registerVerified(app, owner, `owner-${i}@example.test`);
      await owner.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(owner)).send({ communityId, name: `ร้านคิว ${i}` });
      owners.push(owner);
    }
    const side = 560;
    const pixels = Buffer.alloc(side * side * 3);
    for (let i = 0; i < pixels.length; i += 1) {
      pixels[i] = (i * 2654435761) % 251;
    }
    const png = await sharp(pixels, { raw: { width: side, height: side, channels: 3 } }).png().toBuffer();

    const statuses = await Promise.all(
      owners.map(async (owner) => (await owner.post(`${API}/shops/me/logo`).set(CSRF_HEADER, await csrfToken(owner)).attach('file', png, 'logo.png')).status),
    );

    expect(statuses).toEqual(Array(8).fill(200));
  });
});
