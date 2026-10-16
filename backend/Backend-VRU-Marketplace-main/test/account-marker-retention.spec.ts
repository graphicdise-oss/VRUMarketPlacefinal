import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { API, CURRENT_ACCEPTANCES, GOOD_PASSWORD, csrfToken, register, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #22 — how long a `DeletedAccountMarker` is kept.
 *
 * K16 kept one marker per erased account so a banned person cannot come back clean under the same
 * address, and never said for how long. The decision (see `docs/DECISIONS.md`): a marker whose
 * account was banned is kept indefinitely, every other marker is deleted a year after erasure.
 *
 * Seam 2 throughout (M5): arrange over HTTP through the real erasure endpoints, move `clock`, call
 * `sweep.run()` directly, assert. The banned half is observable over HTTP on its own — a kept
 * marker still refuses the registration — which is the half that would be dangerous to get wrong.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SOMCHAI = 'somchai@example.test';

const SWEEP_NAME = 'accountMarkers.purgeUnbanned';
const A_YEAR = 365;

async function signInAsSuperAdmin(app: TestApp): Promise<Agent> {
  const superAdmin = newClient(app);
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });

  return superAdmin;
}

/** How many rows this one task reported deleting — the sweep's own report, not a database read. */
function purged(report: { outcomes: readonly { name: string; handled: number | null }[] }): number | null {
  return report.outcomes.find((outcome) => outcome.name === SWEEP_NAME)?.handled ?? null;
}

/** Registers, erases through the real endpoint, and leaves a `wasBanned = false` marker behind. */
async function registerThenEraseSelf(app: TestApp, email: string): Promise<void> {
  const client = newClient(app);
  await registerAndLogin(client, email);
  await client.post(`${API}/auth/account/erase`).set(CSRF_HEADER, await csrfToken(client)).expect(204);
}

/** Registers, gets banned, and is erased by a super admin (#74) — a `wasBanned = true` marker. */
async function registerThenBanAndErase(app: TestApp, email: string): Promise<void> {
  const client = newClient(app);
  await registerAndLogin(client, email);
  const { id } = await app.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  const superAdmin = await signInAsSuperAdmin(app);
  await superAdmin
    .post(`${API}/admin/users/${id}/ban`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ reason: 'ขายของผิดกฎซ้ำหลายครั้ง' })
    .expect(204);
  await superAdmin
    .post(`${API}/admin/users/${id}/erase`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ reason: 'คำขอลบข้อมูลตาม PDPA เลขที่ 2026-002' }) // §86: an admin erasure needs a reason
    .expect(204);
}

describe('#22 — a marker that never blocked anything is deleted a year after erasure', () => {
  it('keeps it until the year is up', async () => {
    const app = getApp();
    await registerThenEraseSelf(app, SOMCHAI);

    app.clock.advanceByDays(A_YEAR - 1);
    const report = await app.sweep.run();

    expect(purged(report)).toBe(0);
    expect(await app.prisma.deletedAccountMarker.count()).toBe(1);
  });

  it('deletes it once the year is up', async () => {
    const app = getApp();
    await registerThenEraseSelf(app, SOMCHAI);

    app.clock.advanceByDays(A_YEAR + 1);
    const report = await app.sweep.run();

    expect(purged(report)).toBe(1);
    expect(await app.prisma.deletedAccountMarker.count()).toBe(0);
  });

  it('deletes nothing on a second pass, so the daily cron is safe to repeat', async () => {
    const app = getApp();
    await registerThenEraseSelf(app, SOMCHAI);

    app.clock.advanceByDays(A_YEAR + 1);
    await app.sweep.run();
    const second = await app.sweep.run();

    expect(purged(second)).toBe(0);
  });

  it('still lets that address register again afterwards — the door was never closed', async () => {
    const app = getApp();
    await registerThenEraseSelf(app, SOMCHAI);

    app.clock.advanceByDays(A_YEAR + 1);
    await app.sweep.run();
    await register(newClient(app), SOMCHAI);

    // A fresh row, not the erased one: erasure overwrote that address, so a match here can only
    // be the new account.
    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(1);
  });
});

describe('#22 — a banned account’s marker is kept indefinitely', () => {
  it('survives the sweep a year later', async () => {
    const app = getApp();
    await registerThenBanAndErase(app, SOMCHAI);

    app.clock.advanceByDays(A_YEAR + 1);
    const report = await app.sweep.run();

    expect(purged(report)).toBe(0);
    expect(await app.prisma.deletedAccountMarker.count({ where: { wasBanned: true } })).toBe(1);
  });

  it('still refuses the registration ten years on (K16)', async () => {
    const app = getApp();
    await registerThenBanAndErase(app, SOMCHAI);

    app.clock.advanceByDays(A_YEAR * 10);
    await app.sweep.run();

    // K16 answers 202 either way and says nothing about why, so what proves the block is that no
    // account came into being.
    const newcomer = newClient(app);
    await newcomer
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(newcomer))
      .send({
        email: SOMCHAI,
        password: GOOD_PASSWORD,
        ...CURRENT_ACCEPTANCES,
      })
      .expect(202);

    expect(await app.prisma.user.count({ where: { email: SOMCHAI } })).toBe(0);
  });
});
