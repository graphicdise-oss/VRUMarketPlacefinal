import {
  ACCESS_TOKEN_TTL_MINUTES,
  REFRESH_TOKEN_RACE_GRACE_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
} from '../src/auth/auth-policy.js';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../src/auth/cookies.js';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { MeDto } from '../src/auth/dto/me.dto.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { MS_PER_SECOND } from '../src/time/clock.js';
import {
  API,
  CURRENT_ACCEPTANCES,
  GOOD_PASSWORD,
  csrfToken,
  login,
  register,
  registerAndLogin,
  setCookie,
  setCookieAttributes,
} from './helpers/auth.js';
import { newClient, setupTestApp } from './helpers/test-app.js';

const getApp = setupTestApp();

const SOMCHAI = 'somchai@example.test';
const MALEE = 'malee@example.test';

describe('registering', () => {
  it('creates an account that can then sign in', async () => {
    const { client } = getApp();

    await register(client, SOMCHAI);

    const response = await login(client, SOMCHAI);
    expect(response.status).toBe(200);
    expect((response.body as MeDto).email).toBe(SOMCHAI);
  });

  it('answers an address that is already taken exactly as it answers a new one', async () => {
    const { client, prisma } = getApp();

    const first = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({
        email: SOMCHAI,
        password: GOOD_PASSWORD,
        ...CURRENT_ACCEPTANCES,
      });

    const second = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({
        email: SOMCHAI,
        password: 'a-completely-different-one',
        ...CURRENT_ACCEPTANCES,
      });

    // Same status, same body, nothing to tell them apart. I16: nobody may use this endpoint to
    // find out who has an account here.
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(second.headers['set-cookie']).toBeUndefined();

    // And the second attempt did not overwrite the first account's password.
    expect(await prisma.user.count({ where: { email: SOMCHAI } })).toBe(1);
    const stillTheFirstPassword = await login(client, SOMCHAI, GOOD_PASSWORD);
    expect(stillTheFirstPassword.status).toBe(200);
  });

  it('does not sign the new account in', async () => {
    const { client } = getApp();

    const response = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({
        email: SOMCHAI,
        password: GOOD_PASSWORD,
        ...CURRENT_ACCEPTANCES,
      })
      .expect(202);

    // Cookies on success would announce the outcome more loudly than any message, which is the
    // whole point of the identical answers above.
    expect(response.headers['set-cookie']).toBeUndefined();
    await client.get(`${API}/auth/me`).expect(401);
  });

  it('treats capitalisation and spacing as the same address', async () => {
    const { client, prisma } = getApp();

    await register(client, '  SomChai@Example.TEST ');

    // One account, stored lowercased — not a second person who differs only in shift keys.
    const users = await prisma.user.findMany({ select: { email: true } });
    expect(users).toEqual([{ email: SOMCHAI }]);

    expect((await login(client, SOMCHAI)).status).toBe(200);
  });

  it('stores the password only as an argon2id hash', async () => {
    const { client, prisma } = getApp();

    await register(client, SOMCHAI);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: SOMCHAI },
      select: { passwordHash: true, emailVerifiedAt: true, bannedAt: true, role: true },
    });

    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(GOOD_PASSWORD);
    // Unverified, and an ordinary user. #25 owns verification; #29 owns bans.
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.bannedAt).toBeNull();
    expect(user.role).toBe('USER');
  });

  it('rejects a password below the minimum, naming the field', async () => {
    const { client } = getApp();

    const response = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({
        email: SOMCHAI,
        password: 'short',
        ...CURRENT_ACCEPTANCES,
      })
      .expect(400);

    const body = response.body as ErrorBody;
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fieldErrors?.password).toBeDefined();
    // The rejected password must not come back in the error, even as an echo of what was sent.
    expect(JSON.stringify(body)).not.toContain('short');
  });

  it('rejects an address that is not an address', async () => {
    const { client } = getApp();

    const response = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(client))
      .send({
        email: 'not-an-email',
        password: GOOD_PASSWORD,
        ...CURRENT_ACCEPTANCES,
      })
      .expect(400);

    expect((response.body as ErrorBody).fieldErrors?.email).toBeDefined();
  });
});

describe('signing in', () => {
  it('sets both cookies httpOnly and returns who you are', async () => {
    const { client } = getApp();

    const response = await registerAndLogin(client, SOMCHAI);

    const body = response.body as MeDto;
    expect(body.email).toBe(SOMCHAI);
    expect(body.role).toBe('USER');
    expect(body.emailVerified).toBe(false);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    // B3: both tokens are in httpOnly cookies, so no script can read them. That is also why
    // /auth/me has to exist at all.
    const access = setCookieAttributes(response, ACCESS_TOKEN_COOKIE);
    expect(access).toContain('httponly');
    expect(access).toContain('samesite=lax');
    expect(access).toContain('path=/api/v1');

    const refresh = setCookieAttributes(response, REFRESH_TOKEN_COOKIE);
    expect(refresh).toContain('httponly');
    expect(refresh).toContain('samesite=lax');
    // Scoped tighter than the access cookie: only /auth reads it, so it is not sent anywhere else.
    expect(refresh).toContain('path=/api/v1/auth');

    // Secure is set in production only — a Secure cookie is not sent over plain http, and local
    // development is plain http. The test app runs with NODE_ENV=test.
    expect(access).not.toContain('secure');
  });

  it('answers a wrong password and an unknown address identically', async () => {
    const { client } = getApp();

    await register(client, SOMCHAI);

    const wrongPassword = await login(client, SOMCHAI, 'not-the-right-password');
    const noSuchAccount = await login(client, 'nobody@example.test', GOOD_PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(noSuchAccount.status).toBe(401);
    expect((wrongPassword.body as ErrorBody).code).toBe('INVALID_CREDENTIALS');
    expect(noSuchAccount.body).toEqual(wrongPassword.body);
  });

  it('refuses a banned account that gave the right password', async () => {
    const { client, prisma, clock } = getApp();

    await register(client, SOMCHAI);
    // Written directly on purpose (#76 keeps it): this file tests the login and the guard reading
    // `bannedAt` from the database, apart from `POST /admin/users/:id/ban`, which also ends sessions.
    await prisma.user.update({ where: { email: SOMCHAI }, data: { bannedAt: clock.now() } });

    const response = await login(client, SOMCHAI);

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('ACCOUNT_BANNED');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('never puts a token in a response body, on any endpoint of this topic', async () => {
    const { client } = getApp();

    const signedIn = await registerAndLogin(client, SOMCHAI);
    const accessToken = setCookie(signedIn, ACCESS_TOKEN_COOKIE);
    const refreshToken = setCookie(signedIn, REFRESH_TOKEN_COOKIE);

    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();

    const refreshed = await client
      .post(`${API}/auth/refresh`)
      .set(CSRF_HEADER, await csrfToken(client));
    const me = await client.get(`${API}/auth/me`);
    const csrf = await client.get(`${API}/auth/csrf`);
    const loggedOut = await client
      .post(`${API}/auth/logout`)
      .set(CSRF_HEADER, await csrfToken(client));

    // Every token this session has ever held, against every body it has ever received. The
    // rotated pair is included, because a refresh is the other place tokens are minted.
    const tokens = [
      accessToken,
      refreshToken,
      setCookie(refreshed, ACCESS_TOKEN_COOKIE),
      setCookie(refreshed, REFRESH_TOKEN_COOKIE),
    ].filter((token): token is string => token !== undefined);

    expect(tokens).toHaveLength(4);

    for (const body of [signedIn.body, refreshed.body, me.body, csrf.body, loggedOut.body]) {
      const serialised = JSON.stringify(body ?? null);

      for (const token of tokens) {
        expect(serialised).not.toContain(token);
      }
    }
  });
});

describe('asking who I am', () => {
  it('answers 401 when nobody is signed in', async () => {
    const { client } = getApp();

    const response = await client.get(`${API}/auth/me`).expect(401);
    expect((response.body as ErrorBody).code).toBe('UNAUTHENTICATED');
  });

  it('reads the account from the database on every request, not from the token', async () => {
    const { client, prisma, clock } = getApp();

    await registerAndLogin(client, SOMCHAI);
    expect(((await client.get(`${API}/auth/me`).expect(200)).body as MeDto).emailVerified).toBe(
      false,
    );

    // Nothing about the cookie changed. If the guard trusted the token, this would still say
    // false — and #25's verification, #29's ban and topic 3's roles would all be invisible until
    // the access token happened to expire.
    await prisma.user.update({
      where: { email: SOMCHAI },
      data: { emailVerifiedAt: clock.now(), role: 'SUPER_ADMIN' },
    });

    const body = (await client.get(`${API}/auth/me`).expect(200)).body as MeDto;
    expect(body.emailVerified).toBe(true);
    expect(body.role).toBe('SUPER_ADMIN');
  });

  it('refuses a session that was live when the ban landed (invariant 7)', async () => {
    const { client, prisma, clock } = getApp();

    await registerAndLogin(client, SOMCHAI);
    await client.get(`${API}/auth/me`).expect(200);

    // Directly, not through the ban endpoint: that one also revokes every session, which would
    // hide whether the guard itself re-reads `bannedAt` — the thing this test exists to prove.
    await prisma.user.update({ where: { email: SOMCHAI }, data: { bannedAt: clock.now() } });

    // The cookie was minted before the ban and has not expired. It must still stop working: a
    // ban that waits out the access token's fifteen minutes is not a ban.
    const response = await client.get(`${API}/auth/me`).expect(403);
    expect((response.body as ErrorBody).code).toBe('ACCOUNT_BANNED');
  });

  it('keeps two signed-in people apart', async () => {
    const app = getApp();
    const somchai = app.client;
    const malee = newClient(app);

    await registerAndLogin(somchai, SOMCHAI);
    await registerAndLogin(malee, MALEE);

    expect(((await somchai.get(`${API}/auth/me`)).body as MeDto).email).toBe(SOMCHAI);
    expect(((await malee.get(`${API}/auth/me`)).body as MeDto).email).toBe(MALEE);
  });
});

describe('CSRF', () => {
  it('refuses a request that changes data and has no token', async () => {
    const { client } = getApp();

    const response = await client
      .post(`${API}/auth/register`)
      .send({ email: SOMCHAI, password: GOOD_PASSWORD });

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('CSRF_FAILED');
  });

  it('refuses a token that was not signed by us', async () => {
    const { client } = getApp();

    const response = await client
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, 'nonce.a-signature-we-never-produced')
      .send({ email: SOMCHAI, password: GOOD_PASSWORD });

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('CSRF_FAILED');
  });

  it('refuses one person’s token on another person’s session', async () => {
    const app = getApp();
    const somchai = app.client;
    const malee = newClient(app);

    await registerAndLogin(somchai, SOMCHAI);
    await registerAndLogin(malee, MALEE);

    // The token is bound to the session it was issued for, so it is useless anywhere else. This
    // is what the binding buys over a plain signed token: merely having fetched one is not enough.
    const response = await somchai
      .post(`${API}/auth/logout`)
      .set(CSRF_HEADER, await csrfToken(malee));

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).code).toBe('CSRF_FAILED');
  });

  it('stops honouring the anonymous token once somebody signs in', async () => {
    const { client } = getApp();

    const anonymousToken = await csrfToken(client);
    await register(client, SOMCHAI);
    expect((await login(client, SOMCHAI)).status).toBe(200);

    // Signing in is a change of identity, and a CSRF token must not survive one. The frontend's
    // job is to fetch a new one after login — which is why FRONTEND-NOTES says so twice.
    const stale = await client.post(`${API}/auth/logout`).set(CSRF_HEADER, anonymousToken);
    expect(stale.status).toBe(403);

    await client
      .post(`${API}/auth/logout`)
      .set(CSRF_HEADER, await csrfToken(client))
      .expect(204);
  });

  it('asks nothing of a request that only reads', async () => {
    const { client } = getApp();

    await registerAndLogin(client, SOMCHAI);

    await client.get(`${API}/auth/me`).expect(200);
    await client.get(`${API}/health`).expect(200);
  });
});

describe('token lifetimes, proved by moving the clock (seam 2)', () => {
  it('lets the access token expire after fifteen minutes and refreshes silently', async () => {
    const { client, clock } = getApp();

    await registerAndLogin(client, SOMCHAI);

    clock.advanceByMinutes(ACCESS_TOKEN_TTL_MINUTES - 1);
    await client.get(`${API}/auth/me`).expect(200);

    clock.advanceByMinutes(2);
    const expired = await client.get(`${API}/auth/me`).expect(401);
    expect((expired.body as ErrorBody).code).toBe('UNAUTHENTICATED');

    // The CSRF token still works across this, because it is bound to the session rather than to
    // the access token — which is the whole reason refresh is usable when the access token is
    // already dead.
    await client
      .post(`${API}/auth/refresh`)
      .set(CSRF_HEADER, await csrfToken(client))
      .expect(204);

    await client.get(`${API}/auth/me`).expect(200);
  });

  it('replaces both tokens on refresh, so the spent refresh token stops working', async () => {
    const app = getApp();
    const { client, clock } = app;

    const signedIn = await registerAndLogin(client, SOMCHAI);
    const firstRefreshToken = setCookie(signedIn, REFRESH_TOKEN_COOKIE);

    await client
      .post(`${API}/auth/refresh`)
      .set(CSRF_HEADER, await csrfToken(client))
      .expect(204);

    clock.advanceByMinutes(1);

    // Replaying the spent token from a fresh browser, which is what somebody holding a stolen
    // copy has. Rotation is what limits the damage: the token works until its owner next
    // refreshes, and then it does not.
    //
    // The CSRF token comes from this same client rather than from the signed-in one, because
    // both sides compute the binding from the cookies on the request — a spent refresh token
    // resolves to no session, so the token it gets is the anonymous one. Borrowing the live
    // client's token instead would be refused for the binding rather than for the replay, and
    // the test would pass for the wrong reason.
    const thief = newClient(app);
    const replay = await thief
      .post(`${API}/auth/refresh`)
      .set(CSRF_HEADER, await csrfToken(thief))
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${firstRefreshToken ?? ''}`);

    expect(replay.status).toBe(401);
  });

  describe('two requests racing the same refresh token (§72)', () => {
    // Found in /code-review of #24/#25 (DECISIONS.md §72): two tabs of one browser, sharing one
    // cookie jar, can both fire /auth/refresh with the *same* refresh token — a page reload with
    // several tabs open, or two requests that both saw a 401 on the same expired access token.
    // Before the fix, whichever one lost the compare-and-swap was told the same thing a genuine
    // stolen-token replay is told: 401, cookies cleared. That signed the whole browser out for
    // having done nothing wrong. These tests use two `Agent`s presenting the identical starting
    // cookie rather than two real concurrent requests, because what has to be proven is the
    // *outcome* for the loser's exact token — not that Vitest can race two promises, which proves
    // nothing about which one the database's compare-and-swap let through.
    it('tells the loser it is fine, and does not touch the cookies the winner just set', async () => {
      const app = getApp();
      const winner = app.client;

      const signedIn = await registerAndLogin(winner, SOMCHAI);
      const sharedRefreshToken = setCookie(signedIn, REFRESH_TOKEN_COOKIE);

      // The winner: an ordinary refresh, which succeeds exactly as it always has and sets a new
      // pair. This is the request the compare-and-swap lets through.
      const winnerResponse = await winner
        .post(`${API}/auth/refresh`)
        .set(CSRF_HEADER, await csrfToken(winner))
        .expect(204);
      expect(setCookie(winnerResponse, REFRESH_TOKEN_COOKIE)).not.toBe(sharedRefreshToken);

      // The loser: a second tab of the same browser, presenting the token both tabs held before
      // the winner's response landed. A fresh Agent with that one cookie set by hand stands in for
      // "a tab that has not yet seen the winner's Set-Cookie" — which is exactly the situation a
      // real second tab is in, since the two requests left the browser before either answer came
      // back.
      const loser = newClient(app);
      const loserResponse = await loser
        .post(`${API}/auth/refresh`)
        .set(CSRF_HEADER, await csrfToken(loser))
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${sharedRefreshToken ?? ''}`);

      // Not signed out: a 204, the same status the winner got, not a 401.
      expect(loserResponse.status).toBe(204);
      // And no cookies at all — in particular not the winner's, which this request never saw and
      // must not overwrite the browser's already-current ones with a stale copy of.
      expect(setCookie(loserResponse, ACCESS_TOKEN_COOKIE)).toBeUndefined();
      expect(setCookie(loserResponse, REFRESH_TOKEN_COOKIE)).toBeUndefined();

      // The winner's own new pair is still the one that works — the fix does not extend any
      // credential's life, it just stops punishing the request that arrived a moment too late.
      const stillWorks = await winner.get(`${API}/auth/me`);
      expect(stillWorks.status).toBe(200);
    });

    it('stops answering "fine" once the grace window closes, and answers a real replay the same as ever', async () => {
      const app = getApp();
      const { client, clock } = app;

      const signedIn = await registerAndLogin(client, SOMCHAI);
      const spentRefreshToken = setCookie(signedIn, REFRESH_TOKEN_COOKIE);

      await client
        .post(`${API}/auth/refresh`)
        .set(CSRF_HEADER, await csrfToken(client))
        .expect(204);

      // One second past the boundary — this is a genuine replay of a token nobody could still be
      // racing against, and the answer reverts to exactly what an unknown token gets.
      clock.advanceBy(REFRESH_TOKEN_RACE_GRACE_SECONDS * MS_PER_SECOND + MS_PER_SECOND);

      const tooLate = newClient(app);
      const response = await tooLate
        .post(`${API}/auth/refresh`)
        .set(CSRF_HEADER, await csrfToken(tooLate))
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${spentRefreshToken ?? ''}`);

      expect(response.status).toBe(401);
      expect((response.body as ErrorBody).code).toBe('UNAUTHENTICATED');
    });
  });

  it('ends the session thirty days after its last use', async () => {
    const { client, clock } = getApp();

    await registerAndLogin(client, SOMCHAI);

    clock.advanceByDays(REFRESH_TOKEN_TTL_DAYS + 1);

    const response = await client
      .post(`${API}/auth/refresh`)
      .set(CSRF_HEADER, await csrfToken(client));

    expect(response.status).toBe(401);
    // The dead cookies are cleared on the way out, so the frontend is not left retrying forever.
    expect(setCookie(response, ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(setCookie(response, REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });

  it('slides the thirty days on every use, so a weekly visitor never signs in again', async () => {
    const { client, clock } = getApp();

    await registerAndLogin(client, SOMCHAI);

    // Two windows of 29 days each — 58 days in total, nearly twice the refresh token's lifetime.
    // This only passes because the expiry moves forward each time it is used (I17).
    for (let visit = 0; visit < 2; visit += 1) {
      clock.advanceByDays(REFRESH_TOKEN_TTL_DAYS - 1);

      await client
        .post(`${API}/auth/refresh`)
        .set(CSRF_HEADER, await csrfToken(client))
        .expect(204);
    }

    await client.get(`${API}/auth/me`).expect(200);
  });
});

describe('signing out', () => {
  it('makes the cookie the browser already holds stop working', async () => {
    const app = getApp();
    const { client } = app;

    const signedIn = await registerAndLogin(client, SOMCHAI);
    const accessToken = setCookie(signedIn, ACCESS_TOKEN_COOKIE);

    await client
      .post(`${API}/auth/logout`)
      .set(CSRF_HEADER, await csrfToken(client))
      .expect(204);

    // Replaying the exact cookie value from a client that never saw the clearing header — which is
    // what an attacker with a copy of the cookie has. Logout happens on the server, so this fails.
    const replay = await newClient(app)
      .get(`${API}/auth/me`)
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${accessToken ?? ''}`);

    expect(replay.status).toBe(401);
  });

  it('also ends the ability to refresh', async () => {
    const { client } = getApp();

    await registerAndLogin(client, SOMCHAI);

    await client
      .post(`${API}/auth/logout`)
      .set(CSRF_HEADER, await csrfToken(client))
      .expect(204);

    const response = await client
      .post(`${API}/auth/refresh`)
      .set(CSRF_HEADER, await csrfToken(client));

    expect(response.status).toBe(401);
  });

  it('works when the access token has already expired', async () => {
    const { client, clock } = getApp();

    await registerAndLogin(client, SOMCHAI);
    clock.advanceByMinutes(ACCESS_TOKEN_TTL_MINUTES + 1);

    // The common case: the tab was left open. A sign-out that answers 401 is a sign-out that
    // fails exactly when somebody is trying to leave a shared computer.
    await client
      .post(`${API}/auth/logout`)
      .set(CSRF_HEADER, await csrfToken(client))
      .expect(204);
  });

  it('is harmless when nobody was signed in', async () => {
    const { client } = getApp();

    await client
      .post(`${API}/auth/logout`)
      .set(CSRF_HEADER, await csrfToken(client))
      .expect(204);
  });
});

describe('the sweep clears out dead sessions', () => {
  it('is registered with the one sweep point', () => {
    const { sweep } = getApp();

    expect(sweep.registeredTaskNames()).toContain('sessions.removeExpired');
  });

  it('removes sessions past their refresh expiry and keeps the live ones', async () => {
    const app = getApp();
    const { client, clock, prisma, sweep } = app;

    await registerAndLogin(client, SOMCHAI);

    clock.advanceByDays(REFRESH_TOKEN_TTL_DAYS + 1);

    // A second person signs in after the first session has expired, so one row should survive.
    const malee = newClient(app);
    await registerAndLogin(malee, MALEE);

    expect(await prisma.session.count()).toBe(2);

    await sweep.run();

    const remaining = await prisma.session.findMany({ select: { user: { select: { email: true } } } });
    expect(remaining).toEqual([{ user: { email: MALEE } }]);
  });
});
