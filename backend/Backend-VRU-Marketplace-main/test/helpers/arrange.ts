import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../../src/auth/csrf.service.js';
import { API, csrfToken, linkTokenFrom, login, register, verifyEmail, GOOD_PASSWORD } from './auth.js';
import { approveShopAs } from './review.js';
import { newClient, type TestApp } from './test-app.js';

/**
 * #76 (M5): the arrangements almost every spec needs — a verified account, an approved shop —
 * made through the same doors a person uses, not by writing the columns with Prisma.
 *
 * Before this, some forty files set `emailVerifiedAt` and `approvalStatus` directly. That passes
 * today, and stops proving anything the day either step grows a side effect: a test that never
 * clicked the link or never pressed "approve" would not notice that clicking or pressing broke.
 */

/**
 * Registers, opens the verification link from the email the way a person does, and signs in.
 * Returns the new account's id.
 */
export async function registerVerified(app: TestApp, client: Agent, email: string, password = GOOD_PASSWORD): Promise<string> {
  await register(client, email, password);

  const message = app.email.to(email).filter((sent) => sent.kind === 'EMAIL_VERIFICATION').at(-1);
  if (message === undefined) {
    throw new Error(`No verification email reached ${email} — was the address already registered?`);
  }
  const verified = await verifyEmail(client, linkTokenFrom(message.body));
  if (verified.status >= 300) {
    throw new Error(`Could not verify ${email}: ${verified.status}`);
  }

  const session = await login(client, email, password);
  if (session.status !== 200) {
    throw new Error(`Could not sign in as ${email}: ${session.status}`);
  }

  return (session.body as { id: string }).id;
}

/**
 * The platform account that approves (and suspends) shops for specs, so a spec needs no admin of its own. The one
 * thing here still written with Prisma is its role: SUPER_ADMIN has no endpoint on purpose — it
 * is set in the database in production too (N29) — so there is no door to go through instead.
 */
export const SHOP_APPROVER_EMAIL = 'shop-approver@example.test';

/** The platform super admin above, signed in on a fresh client — created on first use in each test. */
async function platformAdmin(app: TestApp): Promise<Agent> {
  const admin = newClient(app);
  const existing = await app.prisma.user.findUnique({ where: { email: SHOP_APPROVER_EMAIL }, select: { id: true } });
  if (existing === null) {
    await registerVerified(app, admin, SHOP_APPROVER_EMAIL);
    await app.prisma.user.update({ where: { email: SHOP_APPROVER_EMAIL }, data: { role: 'SUPER_ADMIN' } });
  } else {
    await login(admin, SHOP_APPROVER_EMAIL);
  }

  return admin;
}

/**
 * Approves a shop through `POST /shops/:id/approve`, as the platform super admin. Its side effects
 * happen as they would for real: a `SHOP_APPROVED` audit row naming that admin, and a
 * notification to the owner.
 */
export async function approveShop(app: TestApp, shopId: string): Promise<void> {
  const admin = await platformAdmin(app);
  // §91: with the revision this admin's view shows, as a reviewer's screen sends it.
  const approved = await approveShopAs(admin, shopId);
  if (approved.status !== 200) {
    throw new Error(`Could not approve shop ${shopId}: ${approved.status} ${JSON.stringify(approved.body)}`);
  }
}

/** Suspends a shop through `POST /shops/:id/suspend` (#38), the same way — freezing its open orders included. */
export async function suspendShop(app: TestApp, shopId: string): Promise<void> {
  const admin = await platformAdmin(app);
  const suspended = await admin
    .post(`${API}/shops/${shopId}/suspend`)
    .set(CSRF_HEADER, await csrfToken(admin))
    .send({ reason: 'ระงับชั่วคราวระหว่างตรวจสอบข้อร้องเรียนจากผู้ซื้อ' });
  if (suspended.status !== 200) {
    throw new Error(`Could not suspend shop ${shopId}: ${suspended.status} ${JSON.stringify(suspended.body)}`);
  }
}
