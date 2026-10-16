import type { Socket as ClientSocket } from 'socket.io-client';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { registerVerified } from './helpers/arrange.js';
import { API, GOOD_PASSWORD, csrfToken, forgotPassword, linkTokenFrom, login, resetPassword, signInWithGoogle } from './helpers/auth.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §98 (owner's decision in §93): the traffic data พ.ร.บ.คอมพิวเตอร์ ม.26 asks a service provider
 * to keep for 90 days — when, from which address, which account, and what was done — and nothing
 * of what was said or sent. Deleted by the one sweep once it is older than 90 days.
 *
 * There is deliberately no endpoint that returns these rows (they exist to be handed to an
 * official on a lawful request, not to be browsed), so the assertions read the table itself.
 */
const getApp = setupTestApp();

const USER = 'user@example.test';

interface LoggedRow {
  userId: string | null;
  ipAddress: string;
  channel: string;
  action: string;
  statusCode: number | null;
  occurredAt: Date;
}

/**
 * Rows are buffered and written in batches about once a second, after the response has gone out
 * (a request must never be slowed or failed by its log line), so a row lands a moment after the
 * client has its answer — polled, never slept.
 */
async function loggedRows(app: TestApp, where: { action?: string; userId?: string | null }, atLeast = 1): Promise<LoggedRow[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    // No endpoint returns access-log rows by design (see the file comment) — read the table.
    const rows = await app.prisma.accessLog.findMany({ where, orderBy: { occurredAt: 'asc' } });
    if (rows.length >= atLeast) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No access-log row matched ${JSON.stringify(where)}`);
}

const openSockets: ClientSocket[] = [];
afterEach(() => {
  for (const socket of openSockets.splice(0)) {
    socket.disconnect();
  }
});

async function connected(socket: ClientSocket): Promise<ClientSocket> {
  openSockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
    socket.connect();
  });
  return socket;
}

describe('§98 — every request leaves who, from where, when and what — never its content', () => {
  it('a signed-in request records the account, the address, the route’s pattern and the status — not its query string', async () => {
    const app = getApp();
    const user = newClient(app);
    const userId = await registerVerified(app, user, USER);

    expect((await user.get(`${API}/products/search?q=${encodeURIComponent('เสื้อสีแดงของสมชาย')}`)).status).toBe(200);

    const [row] = await loggedRows(app, { action: 'GET /api/v1/products/search', userId });
    expect(row).toMatchObject({ userId, channel: 'HTTP', action: 'GET /api/v1/products/search', statusCode: 200 });
    expect(row!.ipAddress).toMatch(/127\.0\.0\.1|::1/);
    expect(JSON.stringify(row)).not.toContain('สมชาย');
  });

  it('a route with ids in its path is recorded by its pattern, so no id or token rides along', async () => {
    const app = getApp();
    const user = newClient(app);
    await registerVerified(app, user, USER);
    app.email.clear();
    await forgotPassword(newClient(app), USER);
    const token = linkTokenFrom(app.email.ofKind('PASSWORD_RESET').at(-1)!.body);

    expect((await resetPassword(newClient(app), token, 'a-completely-different-passphrase')).status).toBe(204);

    const rows = await loggedRows(app, { action: 'POST /api/v1/auth/password/reset' });
    expect(rows[0]!.statusCode).toBe(204);
    const everything = JSON.stringify(await app.prisma.accessLog.findMany()); // the whole table — see the file comment
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(USER);
  });

  it('a sign-in records the account it signed into — and a failed one records the address and nothing about who was tried', async () => {
    const app = getApp();
    const userId = await registerVerified(app, newClient(app), USER);

    expect((await login(newClient(app), USER, GOOD_PASSWORD)).status).toBe(200);
    expect((await login(newClient(app), USER, 'not-the-right-password')).status).toBe(401);

    const rows = await loggedRows(app, { action: 'POST /api/v1/auth/login' }, 3); // registerVerified signs in once too
    const failed = rows.filter((row) => row.statusCode === 401);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.userId).toBeNull();
    expect(rows.filter((row) => row.statusCode === 200).every((row) => row.userId === userId)).toBe(true);
  });

  it('a Google sign-in records the account it signed into, on the callback’s row', async () => {
    const app = getApp();
    const client = newClient(app);

    expect((await signInWithGoogle(client, app.google, USER)).status).toBe(302);

    const me = (await client.get(`${API}/auth/me`)).body as { id: string };
    const [row] = await loggedRows(app, { action: 'GET /api/v1/auth/google/callback' });
    expect(row!.userId).toBe(me.id);
  });

  it('an X-Forwarded-For the caller wrote is not taken as their address when no proxy is configured in front', async () => {
    const app = getApp();

    await newClient(app).get(`${API}/health`).set('X-Forwarded-For', '203.0.113.9');

    const [row] = await loggedRows(app, { action: 'GET /api/v1/health' });
    expect(row!.ipAddress).not.toBe('203.0.113.9');
  });

  it('a chat connection and each event it sends are recorded with the account — the payload is not', async () => {
    const app = getApp();
    const user = newClient(app);
    const userId = await registerVerified(app, user, USER);
    const socket = await connected(chatSocket(app, user));

    await new Promise((resolve) => socket.emit('listRooms', { note: 'ข้อความลับของสมชาย' }, resolve));

    const [connect] = await loggedRows(app, { action: 'WS /chat connect', userId });
    expect(connect).toMatchObject({ channel: 'WEBSOCKET', statusCode: null });
    const [event] = await loggedRows(app, { action: 'WS /chat listRooms', userId });
    expect(event!.ipAddress).toBe(connect!.ipAddress);
    expect(JSON.stringify(await app.prisma.accessLog.findMany())).not.toContain('สมชาย'); // the whole table — see the file comment
  });

  it('a chat event the gateway does not answer is logged as unknown, not by the name the client made up', async () => {
    const app = getApp();
    const user = newClient(app);
    const userId = await registerVerified(app, user, USER);
    const socket = await connected(chatSocket(app, user));

    socket.emit('myNameIsSomchaiAndMyPhoneIs', {});
    await new Promise((resolve) => socket.emit('listRooms', {}, resolve)); // lands after the first

    await loggedRows(app, { action: 'WS /chat listRooms', userId });
    expect(await app.prisma.accessLog.count({ where: { action: 'WS /chat (unknown)', userId } })).toBe(1); // read directly (file comment)
    expect(await app.prisma.accessLog.count({ where: { action: { contains: 'Somchai' } } })).toBe(0);
  });

  it('a token refresh names the account whose session it extended — it arrives with the access token already expired', async () => {
    const app = getApp();
    const user = newClient(app);
    const userId = await registerVerified(app, user, USER);
    app.clock.advanceByMinutes(20); // past the access token's 15 minutes

    expect((await user.post(`${API}/auth/refresh`).set(CSRF_HEADER, await csrfToken(user))).status).toBe(204);

    const [row] = await loggedRows(app, { action: 'POST /api/v1/auth/refresh' });
    expect(row).toMatchObject({ userId, statusCode: 204 });
  });

  it('a row is kept for 90 days, then the sweep deletes it', async () => {
    const app = getApp();
    await newClient(app).get(`${API}/health`);
    await loggedRows(app, { action: 'GET /api/v1/health' });

    app.clock.advanceByDays(90);
    await app.sweep.run();
    expect(await app.prisma.accessLog.count({ where: { action: 'GET /api/v1/health' } })).toBe(1); // read directly (file comment) · still inside the 90 days

    app.clock.advanceByMinutes(1);
    await app.sweep.run();
    expect(await app.prisma.accessLog.count({ where: { action: 'GET /api/v1/health' } })).toBe(0);
  });

  it('a request carrying a CSRF-protected write is recorded like any other — method and pattern only', async () => {
    const app = getApp();
    const user = newClient(app);
    const userId = await registerVerified(app, user, USER);

    await user.post(`${API}/auth/logout`).set(CSRF_HEADER, await csrfToken(user));

    const [row] = await loggedRows(app, { action: 'POST /api/v1/auth/logout' });
    expect(row).toMatchObject({ userId, statusCode: 204 });
  });
});
