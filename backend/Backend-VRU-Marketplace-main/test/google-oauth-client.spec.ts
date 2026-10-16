import { vi } from 'vitest';
import { GoogleOAuthClient } from '../src/auth/google-oauth.client.js';
import { AppConfig } from '../src/config/app-config.module.js';
import { Clock } from '../src/time/clock.js';
import { setupTestApp } from './helpers/test-app.js';

/**
 * §115 — `GoogleOAuthClient` with a stubbed `fetch`: the same narrow exception `email.spec.ts`
 * states for `BrevoEmailSender`. Every test binds `FakeGoogleIdentity`, by design, so the real
 * client's failure paths are never reached through HTTP; if they are not tested here they are
 * never tested.
 *
 * What it guards: the `reason` a failed exchange returns goes straight into a log line
 * (`GoogleAuthService`), and a log holds only what could be shown in public (CLAUDE.md). A network
 * error's message is free text from whichever layer failed — a proxy that quotes the request, a
 * TLS stack — so only its kind may reach the reason.
 */
const getApp = setupTestApp();

function client(): GoogleOAuthClient {
  const { app } = getApp();
  return new GoogleOAuthClient(app.get(AppConfig), app.get(Clock));
}

describe('§115 — a failed exchange with Google is described by its kind, never by its text', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a network failure gives the error’s class and code, not its message', async () => {
    const secretish = 'proxy refused POST https://oauth2.googleapis.com/token?code=4/0AY-secret-code';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new TypeError(secretish), { cause: { code: 'ECONNREFUSED' } })));

    const result = await client().exchangeCode('4/0AY-secret-code');

    expect(result.ok).toBe(false);
    const reason = result.ok ? '' : result.reason;
    expect(reason).toContain('TypeError/ECONNREFUSED');
    expect(reason).not.toContain('secret-code');
    expect(reason).not.toContain('proxy refused');
  });

  it('a refusal from Google gives only the status, as before', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"invalid_grant","code":"4/0AY-secret-code"}', { status: 400 })));

    const result = await client().exchangeCode('4/0AY-secret-code');

    expect(result).toEqual({ ok: false, reason: 'Google refused the exchange with HTTP 400' });
  });
});
