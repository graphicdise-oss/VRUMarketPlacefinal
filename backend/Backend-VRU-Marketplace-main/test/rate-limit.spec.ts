import type { Agent, Response } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import {
  API,
  CURRENT_ACCEPTANCES,
  GOOD_PASSWORD,
  csrfToken,
  forgotPassword,
  login,
  register,
} from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

const getApp = setupTestApp();

const SOMCHAI = 'somchai@example.test';

/**
 * The ceilings as configured for this run, not as written in I17.
 *
 * #28 requires that every number come from configuration, so a test carrying its own copy of 10
 * would keep passing after somebody lowered the real limit to 5 — and the thing worth proving is
 * that the configured number is the one enforced.
 */
function limit(name: string, fallback: number): number {
  return Number(process.env[name] ?? String(fallback));
}

const LOGIN_PER_15_MIN = limit('RATE_LIMIT_LOGIN_PER_15_MIN', 10);
const LOGIN_PER_IP_PER_HOUR = limit('RATE_LIMIT_LOGIN_PER_IP_PER_HOUR', 60);
const REGISTER_PER_HOUR = limit('RATE_LIMIT_REGISTER_PER_HOUR', 5);
const REGISTER_PER_IP_PER_HOUR = limit('RATE_LIMIT_REGISTER_PER_IP_PER_HOUR', 20);
const EMAIL_LINK_PER_HOUR = limit('RATE_LIMIT_EMAIL_LINK_PER_HOUR', 3);

/** Runs something n times and returns every response, so a test can look at the boundary. */
async function repeat(times: number, attempt: (index: number) => Promise<Response>) {
  const responses: Response[] = [];

  for (let index = 0; index < times; index += 1) {
    responses.push(await attempt(index));
  }

  return responses;
}

function isRateLimited(response: Response): boolean {
  return response.status === 429 && (response.body as ErrorBody).code === 'RATE_LIMITED';
}

async function registerAs(client: Agent, email: string): Promise<Response> {
  return client
    .post(`${API}/auth/register`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({
      email,
      password: GOOD_PASSWORD,
      ...CURRENT_ACCEPTANCES,
    });
}

describe('signing in', () => {
  it('refuses after the configured number of attempts in the window', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    const attempts = await repeat(LOGIN_PER_15_MIN + 1, () =>
      login(newClient(app), SOMCHAI, 'the-wrong-passphrase'),
    );

    // Everything up to the ceiling is answered on its merits...
    expect(attempts.slice(0, LOGIN_PER_15_MIN).every((response) => response.status === 401)).toBe(
      true,
    );
    // ...and the one past it is refused before the password is even hashed.
    expect(isRateLimited(attempts[LOGIN_PER_15_MIN] as Response)).toBe(true);
  });

  it('never locks the account — the window reopens and the right password still works', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    await repeat(LOGIN_PER_15_MIN + 3, () => login(newClient(app), SOMCHAI, 'the-wrong-passphrase'));

    // Still refused a moment later, so the limit is real...
    expect(isRateLimited(await login(newClient(app), SOMCHAI, GOOD_PASSWORD))).toBe(true);

    // ...and gone a quarter of an hour after that. This is the whole of I17's objection to
    // account lockout: a limit anybody can hold shut on somebody else's account, by continuing to
    // knock, is a harassment tool the system built for them. Knocking during the window did not
    // extend it either — the attempts above ran past the ceiling on purpose.
    app.clock.advanceByMinutes(16);

    const afterTheWindow = await login(newClient(app), SOMCHAI, GOOD_PASSWORD);
    expect(afterTheWindow.status).toBe(200);
  });

  it('counts one address at a time, not everybody behind the same router', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    await register(newClient(app), 'malee@example.test');

    // Somchai's allowance is spent from this address.
    await repeat(LOGIN_PER_15_MIN + 1, () => login(newClient(app), SOMCHAI, 'the-wrong-passphrase'));
    expect(isRateLimited(await login(newClient(app), SOMCHAI, GOOD_PASSWORD))).toBe(true);

    // Malee is behind the same address — a shared wifi, a mobile carrier's CGNAT range, an
    // office — which is an ordinary thing to happen on the open internet, and why #28 refuses to
    // count by IP alone.
    const malee = await login(newClient(app), 'malee@example.test');
    expect(malee.status).toBe(200);
  });

  it('says the same thing whether or not the address has an account', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    const registered = await repeat(LOGIN_PER_15_MIN + 1, () =>
      login(newClient(app), SOMCHAI, 'the-wrong-passphrase'),
    );
    const invented = await repeat(LOGIN_PER_15_MIN + 1, () =>
      login(newClient(app), 'nobody@example.test', 'the-wrong-passphrase'),
    );

    const lastRegistered = registered[LOGIN_PER_15_MIN] as Response;
    const lastInvented = invented[LOGIN_PER_15_MIN] as Response;

    // One address has an account here and the other does not, and both run out of attempts at the
    // same point with the same answer. A counter kept only for addresses that exist would be the
    // membership oracle I16 closed everywhere else in this topic, arriving through a side door:
    // "this one starts refusing at ten, that one never does".
    expect(lastInvented.status).toBe(lastRegistered.status);
    expect((lastInvented.body as ErrorBody).code).toBe((lastRegistered.body as ErrorBody).code);
    expect((lastInvented.body as ErrorBody).message).toBe((lastRegistered.body as ErrorBody).message);

    // And the tenth attempt on each was still answered on its merits, so the refusal really is
    // the ceiling and not something about the address.
    expect(registered[LOGIN_PER_15_MIN - 1]?.status).toBe(401);
    expect(invented[LOGIN_PER_15_MIN - 1]?.status).toBe(401);
  });

  it('also caps sign-in attempts from one address, whatever the emails (§71)', async () => {
    // Found in /code-review of #24/#25 (DECISIONS.md §71): the ceiling above is keyed on
    // (IP + email), so an attacker who tries a fresh address every time — credential stuffing, a
    // list of addresses with one guessed password apiece — never meets it at all. This is the
    // second layer, the same shape as 'registerPerIp' below: it exists to bound the argon2 cost
    // any one source can impose, not to protect any single account.
    const app = getApp();

    const attempts = await repeat(LOGIN_PER_IP_PER_HOUR + 1, (index) =>
      login(newClient(app), `person-${String(index)}@example.test`, 'the-wrong-passphrase'),
    );

    // Every attempt up to the ceiling is answered on its merits (401, not 429) — this is not a
    // stricter version of the (IP + email) rule, it is a wider one that only bites once the
    // address-changing trick has been used enough times.
    expect(
      attempts.slice(0, LOGIN_PER_IP_PER_HOUR).every((response) => response.status === 401),
    ).toBe(true);
    expect(isRateLimited(attempts[LOGIN_PER_IP_PER_HOUR] as Response)).toBe(true);
  });

  it('does not let the per-IP ceiling steal from the per-account one', async () => {
    // The two ceilings are independent counters (see keyFor's rule-name-in-the-key), which this
    // proves from the other direction: spending most of the per-IP allowance on invented
    // addresses must not leave a real account with fewer than its own ten attempts.
    const app = getApp();

    await register(app.client, SOMCHAI);
    await repeat(LOGIN_PER_IP_PER_HOUR - LOGIN_PER_15_MIN, (index) =>
      login(newClient(app), `person-${String(index)}@example.test`, 'the-wrong-passphrase'),
    );

    const somchaiAttempts = await repeat(LOGIN_PER_15_MIN, () =>
      login(newClient(app), SOMCHAI, 'the-wrong-passphrase'),
    );

    expect(somchaiAttempts.every((response) => response.status === 401)).toBe(true);
  });
});

describe('Retry-After (RFC 9110 §10.2.3)', () => {
  it('names how many seconds are actually left in the window', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);
    await repeat(LOGIN_PER_15_MIN, () => login(newClient(app), SOMCHAI, 'the-wrong-passphrase'));

    // Five minutes into a fifteen-minute window: ten remain.
    app.clock.advanceByMinutes(5);

    const refused = await login(newClient(app), SOMCHAI, 'the-wrong-passphrase');
    expect(isRateLimited(refused)).toBe(true);
    expect(Number(refused.headers['retry-after'])).toBe(10 * 60);
  });

  it('is the same number whether or not the address has an account', async () => {
    const app = getApp();

    const registered = await repeat(LOGIN_PER_15_MIN + 1, () =>
      login(newClient(app), SOMCHAI, 'the-wrong-passphrase'),
    );
    const invented = await repeat(LOGIN_PER_15_MIN + 1, () =>
      login(newClient(app), 'nobody@example.test', 'the-wrong-passphrase'),
    );

    // The wait comes from the counter, and the counter is keyed on what was attempted rather than
    // on whether it exists (see the test above this one) — so a real wait time carries no more
    // information than the identical 401 already did.
    expect(registered[LOGIN_PER_15_MIN]?.headers['retry-after']).toBe(
      invented[LOGIN_PER_15_MIN]?.headers['retry-after'],
    );
  });

  it('is absent from a response that was not refused', async () => {
    const app = getApp();

    const ok = await login(newClient(app), 'nobody@example.test', 'whatever');
    expect(ok.headers['retry-after']).toBeUndefined();
  });

  it('is readable by the frontend across origins, not just present on the wire', async () => {
    // Found in /code-review of #24/#25 (DECISIONS.md §74): the header was set on every refusal,
    // but `enableCors` never listed it in `exposedHeaders`, so browser JavaScript running on
    // FRONTEND_BASE_URL received the response with the header stripped out — the CORS spec
    // exposes only a small safelist unless the server names anything beyond it. A test that never
    // sends `Origin` would not have caught this: CORS header-filtering only applies to
    // cross-origin requests, and supertest's default request looks same-origin to the browser
    // rules `cors` implements.
    const app = getApp();

    await register(app.client, SOMCHAI);
    await repeat(LOGIN_PER_15_MIN, () => login(newClient(app), SOMCHAI, 'the-wrong-passphrase'));

    const client = newClient(app);
    const refused = await client
      .post(`${API}/auth/login`)
      .set(CSRF_HEADER, await csrfToken(client))
      .set('Origin', 'http://localhost:5173')
      .send({ email: SOMCHAI, password: 'the-wrong-passphrase' });

    expect(isRateLimited(refused)).toBe(true);
    expect(refused.headers['access-control-expose-headers']?.toLowerCase()).toContain(
      'retry-after',
    );
  });
});

describe('registering', () => {
  it('refuses repeats of the same address from the same place', async () => {
    const app = getApp();

    const attempts = await repeat(REGISTER_PER_HOUR + 1, () => registerAs(newClient(app), SOMCHAI));

    expect(attempts.slice(0, REGISTER_PER_HOUR).every((response) => response.status === 202)).toBe(
      true,
    );
    expect(isRateLimited(attempts[REGISTER_PER_HOUR] as Response)).toBe(true);
  });

  it('also caps how many accounts one address can create, whatever the emails', async () => {
    const app = getApp();

    // The reason the ceiling above is not enough on its own: picking a new address costs an
    // attacker nothing, so a limit keyed on the address is not a limit on registering.
    const attempts = await repeat(REGISTER_PER_IP_PER_HOUR + 1, (index) =>
      registerAs(newClient(app), `person-${String(index)}@example.test`),
    );

    expect(
      attempts.slice(0, REGISTER_PER_IP_PER_HOUR).every((response) => response.status === 202),
    ).toBe(true);
    expect(isRateLimited(attempts[REGISTER_PER_IP_PER_HOUR] as Response)).toBe(true);
  });

  it('lets the hour pass and starts again', async () => {
    const app = getApp();

    await repeat(REGISTER_PER_HOUR + 1, () => registerAs(newClient(app), SOMCHAI));
    expect(isRateLimited(await registerAs(newClient(app), SOMCHAI))).toBe(true);

    app.clock.advanceByHours(1);

    expect((await registerAs(newClient(app), SOMCHAI)).status).toBe(202);
  });
});

describe('the endpoints that send email', () => {
  it('caps asking for a reset link', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    const attempts = await repeat(EMAIL_LINK_PER_HOUR + 1, () =>
      forgotPassword(newClient(app), SOMCHAI),
    );

    expect(attempts.slice(0, EMAIL_LINK_PER_HOUR).every((response) => response.status === 202)).toBe(
      true,
    );
    expect(isRateLimited(attempts[EMAIL_LINK_PER_HOUR] as Response)).toBe(true);
  });

  it('caps asking for a verification link', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    const resend = async () =>
      newClient(app)
        .post(`${API}/auth/resend-verification`)
        .set(CSRF_HEADER, await csrfToken(app.client))
        .send({ email: SOMCHAI });

    const attempts = await repeat(EMAIL_LINK_PER_HOUR + 1, resend);

    expect(isRateLimited(attempts[EMAIL_LINK_PER_HOUR] as Response)).toBe(true);
  });

  it('keeps a separate allowance per endpoint', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    await repeat(EMAIL_LINK_PER_HOUR, () => forgotPassword(newClient(app), SOMCHAI));
    expect(isRateLimited(await forgotPassword(newClient(app), SOMCHAI))).toBe(true);

    // Spending one allowance must not spend another's: the counter's key carries the rule's name
    // for exactly this reason. Without it, asking for a reset would silently use up the
    // verification resends, and the person would be stuck with no way to prove their address.
    const resent = await newClient(app)
      .post(`${API}/auth/resend-verification`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ email: SOMCHAI });

    expect(resent.status).toBe(202);
  });
});

describe('what is left alone', () => {
  it('does not limit ordinary reads', async () => {
    const app = getApp();

    // The decorator is opt-in, and this is what that buys: a route nobody thought about is not
    // quietly given a ceiling that will surprise somebody at three in the morning.
    const reads = await repeat(30, () => app.client.get(`${API}/auth/csrf`));

    expect(reads.every((response) => response.status === 200)).toBe(true);
  });

  it('does not count a request that fails the CSRF check', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    // Refused before this guard runs, so it never reaches a handler and never touches a counter.
    // The alternative would hand anybody a way to spend somebody else's allowance with requests
    // the system was going to throw away anyway.
    const forged = await repeat(LOGIN_PER_15_MIN + 5, () =>
      newClient(app).post(`${API}/auth/login`).send({ email: SOMCHAI, password: GOOD_PASSWORD }),
    );
    expect(forged.every((response) => response.status === 403)).toBe(true);

    expect((await login(newClient(app), SOMCHAI)).status).toBe(200);
  });
});

describe('the counters are tidied by the one sweep (M5)', () => {
  it('drops windows that have closed', async () => {
    const app = getApp();

    await repeat(3, () => login(newClient(app), SOMCHAI, 'the-wrong-passphrase'));

    // Nothing to do while the windows are open.
    expect(handledBySweep(await app.sweep.run(), 'rateLimits.removeClosedWindows')).toBe(0);

    app.clock.advanceByHours(2);

    // In memory rather than in a table, these would otherwise be kept for as long as the process
    // lives — one entry per address anybody has ever tried, which an attacker mints as fast as
    // they can invent addresses.
    expect(handledBySweep(await app.sweep.run(), 'rateLimits.removeClosedWindows')).toBeGreaterThan(
      0,
    );
  });

  it('does not hand back an hour-long allowance when a shorter window closes', async () => {
    const app = getApp();

    await register(app.client, SOMCHAI);

    // Spend the register allowance, which runs on an hour.
    await repeat(REGISTER_PER_HOUR, () => registerAs(newClient(app), SOMCHAI));
    expect(isRateLimited(await registerAs(newClient(app), SOMCHAI))).toBe(true);

    // Twenty minutes later the *login* window (fifteen minutes) has closed, but the register one
    // has not. Tidying up must be able to tell the difference.
    app.clock.advanceByMinutes(20);
    await app.sweep.run();

    // The invariant: tidying up must never hand an allowance back early.
    //
    // ⚠️ This test would have passed against the bug it is written about. Pruning used to take the
    // window of whichever rule happened to be asking, but only on the path inside `consume` that
    // fires above ten thousand live counters — and ten thousand counters cannot be arranged
    // through HTTP at any sensible speed. The sweep, which this exercises, always passed the right
    // cutoff. The bug is gone because `pruneExpired` no longer takes a cutoff at all, which is a
    // fix by construction rather than one a test defends; this stands as the statement of what
    // must stay true.
    expect(isRateLimited(await registerAs(newClient(app), SOMCHAI))).toBe(true);

    app.clock.advanceByHours(1);
    expect((await registerAs(newClient(app), SOMCHAI)).status).toBe(202);
  });
});

function handledBySweep(report: Awaited<ReturnType<TestApp['sweep']['run']>>, name: string): number {
  const outcome = report.outcomes.find((each) => each.name === name);

  if (outcome === undefined) {
    throw new Error(`The sweep did not run ${name}.`);
  }

  return outcome.handled ?? -1;
}
