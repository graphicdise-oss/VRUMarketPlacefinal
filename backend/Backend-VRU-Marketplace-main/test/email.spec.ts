import { Logger } from '@nestjs/common';
import { BrevoEmailSender } from '../src/email/brevo-email-sender.js';
import { EmailSender } from '../src/email/email-sender.js';
import { FrontendLinks } from '../src/email/frontend-links.js';
import { FakeEmailSender } from './helpers/fake-email-sender.js';
import { setupTestApp } from './helpers/test-app.js';

const getApp = setupTestApp();

/**
 * #19 says topic 1 has nothing that sends email, so the flow cannot be proven over HTTP here — the
 * verification email at registration in topic 2 does that, and is required to use this interface.
 *
 * Two things are nonetheless tested directly, and the reasoning differs for each:
 *
 *  - `FrontendLinks` is a pure URL builder. Same justification as the money helpers: no I/O, no
 *    state, and a link assembled wrongly is a verification email that silently does not work.
 *  - `BrevoEmailSender` is tested with a stubbed `fetch`, which is the narrow exception worth
 *    stating out loud. Its entire job is translating a provider's response into our result, and
 *    **no test in any topic will ever exercise it** — every test binds the fake, by design. If it
 *    is not tested here it is never tested, and the first time anyone learns that a 429 was treated
 *    as permanent is in production.
 */
describe('the email seam', () => {
  it('resolves to the Brevo sender in the application, and to the fake in tests', () => {
    const { app, email } = getApp();

    // The override is what makes A4 true by construction: nothing in src/ can reach Brevo except
    // through this token, so a test swapping the token swaps the whole system's email.
    expect(app.get(EmailSender)).toBe(email);
    expect(email).toBeInstanceOf(FakeEmailSender);
  });

  it('has the provider behind the interface, not beside it', () => {
    // The Brevo client exists only as an implementation of the token. Anything wanting to send mail
    // asks for EmailSender and gets whatever is bound — which is how A4's "no module calls Brevo
    // directly" holds by construction rather than by discipline.
    expect(Object.getPrototypeOf(BrevoEmailSender.prototype)).toBe(EmailSender.prototype);
  });
});

describe('the fake records what a flow sent', () => {
  it('captures the message, the recipient and the count', async () => {
    const { email } = getApp();

    await email.send({
      to: 'buyer@example.test',
      subject: 'ยืนยันอีเมล',
      body: 'กดลิงก์',
      kind: 'EMAIL_VERIFICATION',
    });

    expect(email.sent).toHaveLength(1);
    expect(email.to('buyer@example.test')).toHaveLength(1);
    expect(email.ofKind('EMAIL_VERIFICATION')).toHaveLength(1);
    expect(email.last()?.subject).toBe('ยืนยันอีเมล');
  });

  it('starts empty in every test', () => {
    // The previous test sent one. Counts carrying over would make "asking twice sends one email"
    // — exactly the kind of assertion topic 2 needs — unreliable.
    expect(getApp().email.sent).toEqual([]);
  });

  it('can be made to fail, and still records the attempt', async () => {
    const { email } = getApp();
    email.failNextSends('provider down');

    const result = await email.send({
      to: 'buyer@example.test',
      subject: 'x',
      body: 'y',
      kind: 'PASSWORD_RESET',
    });

    expect(result).toEqual({ sent: false, retryable: true, reason: 'provider down' });
    // Recorded even though it failed, so a caller that retries shows up as two attempts.
    expect(email.sent).toHaveLength(1);
  });
});

describe('links in emails', () => {
  it('are built from the configured base URL, never a hardcoded domain', () => {
    const links = getApp().app.get(FrontendLinks);

    // The real domain is still undecided (#20). A hardcoded one would mean staging emails pointing
    // at production, or the reverse.
    const verification = links.emailVerification('tok');
    expect(verification.startsWith('http://localhost:5173/')).toBe(true);
    expect(verification).toContain('/verify-email');
  });

  it('percent-encodes the token', () => {
    const links = getApp().app.get(FrontendLinks);

    // Tokens are base64-ish and can contain characters that mean something in a query string. A
    // link that breaks on a `+` is a verification email that silently does not work.
    const url = new URL(links.passwordReset('a+b/c=d&e'));

    expect(url.searchParams.get('token')).toBe('a+b/c=d&e');
    expect(url.toString()).not.toContain('&e=');
  });

  it('keeps a sub-path in the base URL', () => {
    // `new URL('/x', 'https://h/app')` drops `/app`, because a base with no trailing slash treats
    // its last segment as a file. A deployment under a sub-path would get links missing the prefix.
    const links = new FrontendLinks({ frontendBaseUrl: 'https://example.test/app' } as never);

    expect(links.emailVerification('t')).toContain('/app/verify-email');
  });

  it('encodes an id placed in the path', () => {
    const links = getApp().app.get(FrontendLinks);

    expect(links.order('01920000-0000-7000-8000-000000000000')).toMatch(
      /\/orders\/01920000-0000-7000-8000-000000000000$/,
    );
  });
});

describe('the Brevo sender, which no other test will ever run', () => {
  function senderWithFetch(
    respond: () => Promise<Response> | Response,
  ): { sender: BrevoEmailSender; calls: () => number } {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      return Promise.resolve(respond());
    });

    const sender = new BrevoEmailSender({
      brevoApiKey: 'test-key',
      mailFromAddress: 'noreply@example.test',
      mailFromName: 'VRU',
    } as never);

    return { sender, calls: () => calls };
  }

  const message = {
    to: 'someone@example.test',
    subject: 'subject',
    body: 'body',
    kind: 'EMAIL_VERIFICATION',
  } as const;

  it('reports success for a 2xx', async () => {
    const { sender, calls } = senderWithFetch(() => new Response('{}', { status: 201 }));

    await expect(sender.send(message)).resolves.toEqual({ sent: true });
    expect(calls()).toBe(1);
  });

  it('treats a 5xx as retryable', async () => {
    const { sender } = senderWithFetch(() => new Response('', { status: 503 }));

    const result = await sender.send(message);

    expect(result.sent).toBe(false);
    expect(result).toMatchObject({ retryable: true });
  });

  it('treats a 429 as retryable', async () => {
    // The case most likely to be got wrong: rate limiting is temporary, so giving up means
    // silently dropping a verification email during a busy minute.
    const { sender } = senderWithFetch(() => new Response('', { status: 429 }));

    expect(await sender.send(message)).toMatchObject({ sent: false, retryable: true });
  });

  it('treats a rejected address as not retryable', async () => {
    // Sending the same bad address again just produces the same failure.
    const { sender } = senderWithFetch(() => new Response('', { status: 400 }));

    expect(await sender.send(message)).toMatchObject({ sent: false, retryable: false });
  });

  it('treats a transport failure as retryable rather than throwing', async () => {
    const { sender } = senderWithFetch(() => {
      throw new Error('ECONNRESET');
    });

    // Never throws: #19 requires the caller to be told, and topic 2 — which has real users — decides
    // whether a failed verification email should fail the registration.
    const result = await sender.send(message);
    expect(result).toMatchObject({ sent: false, retryable: true });
  });

  it('keeps a transport error’s own text out of the reason it hands back to be logged (§104)', async () => {
    // Every caller logs `reason` verbatim, so it has to be safe to show in public. The error text
    // below is not: a proxy or a TLS layer can put the request's details in its message, and this
    // sender does not get to choose what a lower layer writes there.
    const { sender } = senderWithFetch(() => {
      throw new Error('proxy refused POST for someone@example.test: token=SECRET-TOKEN');
    });
    const warned: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((entry: unknown) => {
      warned.push(String(entry));
    });

    const result = await sender.send(message);

    const logged = [warned.join('\n'), result.sent ? '' : result.reason].join('\n');
    expect(result).toMatchObject({ sent: false, retryable: true });
    expect(logged).not.toContain('someone@example.test');
    expect(logged).not.toContain('SECRET-TOKEN');
  });

  it('never swallows a failure into a success', async () => {
    for (const status of [400, 401, 403, 429, 500, 502, 503]) {
      const { sender } = senderWithFetch(() => new Response('', { status }));

      expect((await sender.send(message)).sent).toBe(false);
    }
  });

  it('sends the body as plain text from the configured sender address', async () => {
    let captured: { body?: unknown } = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      captured = init ?? {};
      return Promise.resolve(new Response('{}', { status: 201 }));
    });

    const sender = new BrevoEmailSender({
      brevoApiKey: 'k',
      mailFromAddress: 'noreply@example.test',
      mailFromName: 'VRU',
    } as never);

    await sender.send(message);

    const payload = JSON.parse(String(captured.body)) as {
      sender: { email: string; name: string };
      to: { email: string }[];
      textContent: string;
      htmlContent?: string;
    };

    expect(payload.sender).toEqual({ email: 'noreply@example.test', name: 'VRU' });
    expect(payload.to).toEqual([{ email: 'someone@example.test' }]);
    expect(payload.textContent).toBe('body');
    // Plain text only, deliberately: an HTML body is a template to maintain and a place for a link
    // to be disguised, and a transactional email that reads as plain text is harder to mistake for
    // phishing.
    expect(payload.htmlContent).toBeUndefined();
  });

  it('logs the kind and nothing else — no recipient, subject, body or link', async () => {
    const logged: string[] = [];
    const { sender } = senderWithFetch(() => new Response('{}', { status: 201 }));
    vi.spyOn(Logger.prototype, 'log').mockImplementation((entry: unknown) => {
      logged.push(String(entry));
    });

    await sender.send({
      to: 'victim@example.test',
      subject: 'ยืนยันอีเมล',
      body: 'http://localhost:5173/verify-email?token=SECRET-TOKEN',
      kind: 'EMAIL_VERIFICATION',
    });

    const all = logged.join('\n');
    // CLAUDE.md: log only what could be shown in public. The verification link *is* the token, so a
    // log line containing it is a log line that can take over an account.
    expect(all).toContain('EMAIL_VERIFICATION');
    expect(all).not.toContain('SECRET-TOKEN');
    expect(all).not.toContain('victim@example.test');
    expect(all).not.toContain('ยืนยันอีเมล');
    expect(all).not.toContain('verify-email');
  });
});
