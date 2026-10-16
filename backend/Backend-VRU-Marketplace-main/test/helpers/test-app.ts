import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CookieAccessInfo } from 'cookiejar';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import request, { type Agent } from 'supertest';
// Nest types getHttpServer() as `any` unless the application is parameterised with the
// server type. Naming it here is what keeps these helpers free of unexplained `any`.
// supertest accepts a net.Server, which http.Server extends.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';
import { GoogleIdentity } from '../../src/auth/google-identity.js';
import { RateLimitService } from '../../src/auth/rate-limit.service.js';
import { initialiseApp } from '../../src/bootstrap.js';
import { EmailSender } from '../../src/email/email-sender.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { Clock } from '../../src/time/clock.js';
import { SweepService } from '../../src/time/sweep.service.js';
import { truncateAllTables } from './database.js';
import { FakeEmailSender } from './fake-email-sender.js';
import { FakeGoogleIdentity } from './fake-google-identity.js';
import { TestClock } from './test-clock.js';

/**
 * Seam 1 from CLAUDE.md: the edge of the real application.
 *
 * A test that reaches a service directly proves the service works. It does not prove that a
 * request reaching the server produces that behaviour — the guard, the validation pipe, the
 * global prefix and the serialisation all sit between the two, and every one of them is
 * somewhere a bug lives. So tests go through HTTP, against a booted Nest and a real
 * Postgres.
 *
 * There is no second way in. No test may import a service or repository and call it, and
 * there is deliberately no endpoint for moving the clock or triggering a sweep — that is
 * seam 2, and it is a direct function call from the test, never a route (see #17).
 */
export interface TestApp {
  /** The booted application, for the rare case a test needs the injector. */
  readonly app: INestApplication<Server>;

  /**
   * An HTTP client that keeps cookies across requests, the way a browser does.
   *
   * Both tokens live in httpOnly cookies (B3), so a client that forgets them cannot
   * represent a logged-in user at all. `request.agent` maintains the jar; use one agent per
   * simulated person, and a fresh one to simulate signing out.
   */
  readonly client: Agent;

  /**
   * `http://127.0.0.1:<port>` — the address the app is actually listening on.
   *
   * #66 is the one feature in this system that needs a real, bound TCP port: `supertest` can
   * drive `client` through the raw `http.Server` object without one (it injects requests
   * directly), but `socket.io-client` is a genuine network client and has nothing to connect to
   * otherwise. `createTestApp()` calls `app.listen(0)` — an OS-assigned free port, so test files
   * running in parallel never collide — purely so `chatSocket()` below has an address.
   */
  readonly baseUrl: string;

  /** Same connection the application uses, for arranging and asserting on data. */
  readonly prisma: PrismaService;

  /**
   * Seam 2: the clock the application reads, which this test can move.
   *
   * Bound over the `Clock` token, so every service in the booted app sees the advanced time —
   * not a copy, and not a mock that only the test knows about.
   */
  readonly clock: TestClock;

  /**
   * Seam 2: the single sweep point, callable directly.
   *
   * The shape of a time test is: arrange over HTTP → move `clock` → `await sweep.run()` → assert
   * over HTTP. There is no endpoint that triggers this, and M5 forbids adding one.
   */
  readonly sweep: SweepService;

  /**
   * The EmailSender the application uses, recording instead of sending.
   *
   * Not a third seam (M5 says so in as many words) — it is how a test asserts what a flow sent, and
   * the only alternative is posting mail to a real provider from a test run.
   */
  readonly email: FakeEmailSender;

  /**
   * Google, recording instead of talking to accounts.google.com.
   *
   * Not a third seam either, for the same reason the email sender is not: it replaces an outbound
   * call to somebody else's server. A Google sign-in test still drives the two real routes over
   * HTTP with a real state cookie.
   */
  readonly google: FakeGoogleIdentity;

  /**
   * Empties every table, returns the clock to its starting instant, clears recorded emails and
   * rate-limit counters, and removes any sweep task a test registered. `setupTestApp()` calls this before each test, which is
   * what makes the order of tests irrelevant.
   */
  reset(): Promise<void>;

  close(): Promise<void>;
}

/**
 * Boots the application once and hands back the tools to drive it.
 *
 * `initialiseApp` is the same function `main.ts` calls, in the same order, so the prefix, the
 * validation pipe, the generated document and the not-found handler all behave here exactly as
 * they do in production. Sequencing those by hand in the helper is precisely how this drifted
 * before: the real server answered 404 for every route while the suite stayed green.
 */
export async function createTestApp(): Promise<TestApp> {
  const clock = new TestClock();
  const email = new FakeEmailSender();
  const google = new FakeGoogleIdentity();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // The only three overrides, and all three replace something outside this system: the wall
    // clock, the mail provider, and Google. Production wires Clock to SystemClock, EmailSender to
    // Brevo and GoogleIdentity to GoogleOAuthClient, and knows nothing about any of these — which
    // is why there is no test-only branch anywhere in src/ that could be switched on by accident.
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(EmailSender)
    .useValue(email)
    .overrideProvider(GoogleIdentity)
    .useValue(google)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<Server>>();
  // The same single sequence main.ts uses. Doing the steps by hand here is how the two paths
  // once drifted into different orders and the suite stopped reflecting the real server.
  await initialiseApp(app);
  // Binds the same underlying `http.Server` `getHttpServer()` returns below to an OS-assigned
  // port. `supertest` works without this (it never opens a real socket), but #66's WebSocket
  // client does — see `TestApp.baseUrl`'s comment.
  await app.listen(0);

  const prisma = app.get(PrismaService);
  const sweep = app.get(SweepService);
  // The rate limiter keeps its counters in memory rather than in a table (#28), so emptying the
  // database is no longer enough to isolate one test from the next: every client in the suite
  // shares one source address, and the file's fourth sign-in attempt would otherwise start
  // where the third one left off.
  const rateLimits = app.get(RateLimitService);
  const server = app.getHttpServer();
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Whatever the application itself registered at boot. Anything beyond this was added by a test,
  // and is removed again on reset — otherwise a stand-in task keeps running for the rest of the
  // file, and a deliberately failing one breaks an assertion three tests away.
  const appRegisteredTasks = new Set(sweep.registeredTaskNames());

  return {
    app,
    client: request.agent(server),
    baseUrl,
    prisma,
    clock,
    sweep,
    email,
    google,
    reset: async () => {
      clock.resetToStart();
      email.clear();
      google.clear();
      await rateLimits.clear();
      for (const name of sweep.registeredTaskNames()) {
        if (!appRegisteredTasks.has(name)) {
          sweep.unregister(name);
        }
      }
      await truncateAllTables(prisma);
    },
    close: () => app.close(),
  };
}

/**
 * A second client against the same running app, with its own empty cookie jar.
 *
 * Most interesting tests in this project involve two people at once — a buyer and a shop
 * owner, or a community admin and someone else's shop. Each needs their own jar, or the
 * second login silently overwrites the first.
 */
export function newClient(testApp: TestApp): Agent {
  return request.agent(testApp.app.getHttpServer());
}

/**
 * #66's own seam-1 wrinkle: "seam 1 ต้องครอบ socket.io client ที่ถือ cookie จริง ไม่ใช่แค่
 * supertest" (#12). A raw `socket.io-client` `io(url)` call has no cookie jar of its own and no
 * way to read one from an `Agent` — cookies only exist here because `newClient`'s `Agent` logged
 * in over HTTP first. This reads that agent's jar (`cookiejar`, the library `supertest` itself
 * is built on) and republishes it as the `Cookie` header socket.io's handshake — a plain HTTP
 * request under the hood — actually sends.
 *
 * `autoConnect: false`: a test that wants to assert "no cookie → rejected at handshake" needs to
 * control exactly when the connection attempt happens, not have it fire during construction.
 * `transports: ['websocket']`: skips the long-polling handshake and connects straight to the
 * transport this deployment actually keeps open, which is also what makes a bad-cookie rejection
 * arrive as a single `connect_error` rather than a polling request that already half-succeeded.
 *
 * Returns a disconnected client — every test calls `.connect()` itself and is responsible for
 * `.disconnect()`ing what it opened, the same ownership `newClient()`'s `Agent` already expects.
 */
export function chatSocket(testApp: TestApp, agent: Agent, options: { origin?: string } = {}): ClientSocket {
  // `/api/v1`, matching the access-token cookie's own `Path` (`cookies.ts`) — a `cookiejar`
  // access check requires the access path to start with the cookie's path, the same rule a
  // browser applies to a WebSocket handshake. `ChatGateway`'s `path: '/api/v1/socket.io'` exists
  // for this exact reason; see that decorator's comment.
  const access = new CookieAccessInfo('127.0.0.1', '/api/v1', false);
  const cookieHeader = agent.jar.getCookies(access).toValueString();

  // `origin` plays the part of the header a browser always attaches to a WebSocket handshake —
  // omitted by default, the way a non-browser client (this one) omits it (§83).
  const originHeader: Record<string, string> = options.origin === undefined ? {} : { Origin: options.origin };

  return ioClient(`${testApp.baseUrl}/chat`, {
    path: '/api/v1/socket.io',
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: cookieHeader, ...originHeader },
  });
}

/**
 * The one line every spec file starts with.
 *
 * Boots the app once for the file, empties the database before each test, and closes it at
 * the end. It returns a getter rather than the app itself because `beforeAll` has not run
 * yet at the point this is called.
 *
 *   const getApp = setupTestApp();
 *   it('...', async () => {
 *     const { client } = getApp();
 *     await client.get('/api/v1/...').expect(200);
 *   });
 *
 * The reset is what makes the order of tests irrelevant, which is an acceptance criterion of
 * #14 and the reason a suite stays trustworthy once it has a few hundred cases in it.
 */
export function setupTestApp(): () => TestApp {
  let testApp: TestApp | undefined;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await testApp?.reset();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  return () => {
    if (!testApp) {
      throw new Error('setupTestApp(): the app is only available inside a test or a hook.');
    }
    return testApp;
  };
}
