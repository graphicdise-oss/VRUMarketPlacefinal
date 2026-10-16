import './helpers/behind-one-proxy.js';
import type { Socket as ClientSocket } from 'socket.io-client';
import { registerVerified } from './helpers/arrange.js';
import { API } from './helpers/auth.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §98 review: the access log's address as it will be in production — behind one Nginx that appends
 * the caller's address to `X-Forwarded-For` (TRUST_PROXY_HOPS=1). This file boots its own app with
 * that setting (`helpers/behind-one-proxy.ts`, imported first); the rest of the suite has no proxy.
 *
 * Both sides must agree: HTTP gets its address from Express's `trust proxy`, the chat handshake
 * never passes through Express and resolves it with the same library and rule.
 */
const getApp = setupTestApp();

const USER = 'user@example.test';
/** What the caller wrote themselves, then what the one proxy appended — the real address. */
const FORWARDED = '198.51.100.66, 203.0.113.7';

async function loggedAddress(app: TestApp, action: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    // No endpoint returns access-log rows by design (see access-log.spec.ts) — read the table.
    const row = await app.prisma.accessLog.findFirst({ where: { action } });
    if (row !== null) {
      return row.ipAddress;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No access-log row for ${action}`);
}

describe('§98 — behind one proxy, the address is the one the proxy saw, on both HTTP and chat', () => {
  let socket: ClientSocket | undefined;
  afterEach(() => socket?.disconnect());

  it('HTTP takes the address one hop from the right, not the one the caller wrote', async () => {
    const app = getApp();

    await newClient(app).get(`${API}/health`).set('X-Forwarded-For', FORWARDED);

    expect(await loggedAddress(app, 'GET /api/v1/health')).toBe('203.0.113.7');
  });

  it('a chat connection resolves the same address the same way', async () => {
    const app = getApp();
    const user = newClient(app);
    await registerVerified(app, user, USER);
    const client = chatSocket(app, user);
    socket = client;
    (client.io.opts.extraHeaders as Record<string, string>)['X-Forwarded-For'] = FORWARDED;

    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
      client.connect();
    });

    expect(await loggedAddress(app, 'WS /chat connect')).toBe('203.0.113.7');
  });
});
