import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { SmtpEmailSender } from '../src/email/smtp-email-sender.js';

/**
 * §107: the SMTP sender, for a university mail system (the owner chose to support it beside Brevo,
 * picked by `EMAIL_TRANSPORT`). Tested against a real SMTP server started in this process — the
 * same narrow exception `email.spec.ts` makes for Brevo: no flow test ever runs a real sender, so
 * this file is the only place its behaviour is pinned.
 *
 * The one thing changed for the test is certificate trust: the local server offers STARTTLS with a
 * self-signed certificate, so the subclass below accepts it. Everything else — requiring TLS,
 * authenticating, the timeouts, how failures are classified — is the production path.
 */
class LocalTrustingSmtpSender extends SmtpEmailSender {
  protected override transportOptions() {
    return { ...super.transportOptions(), tls: { rejectUnauthorized: false } };
  }
}

interface Received {
  from: string;
  to: string[];
  raw: string;
}

const USER = 'noreply@university.test';
const PASSWORD = 'app-password-for-tests';

async function startServer(overrides: Partial<SMTPServerOptions> = {}): Promise<{ port: number; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = new SMTPServer({
    authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, _session, callback) {
      if (auth.username === USER && auth.password === PASSWORD) {
        callback(null, { user: auth.username });
      } else {
        callback(Object.assign(new Error('Invalid credentials'), { responseCode: 535 }));
      }
    },
    onData(stream, session, callback) {
      let raw = '';
      stream.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom === false ? '' : session.envelope.mailFrom.address,
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
        });
        callback();
      });
    },
    logger: false,
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.server.address() as AddressInfo;

  return { port, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function senderFor(port: number, password = PASSWORD): SmtpEmailSender {
  // Only the six settings the sender reads — the same partial-config cast email.spec.ts gives Brevo.
  return new LocalTrustingSmtpSender({
    smtpHost: '127.0.0.1',
    smtpPort: port,
    smtpUser: USER,
    smtpPassword: password,
    mailFromAddress: USER,
    mailFromName: 'VRU Marketplace',
  } as never);
}

const message = { to: 'someone@example.test', subject: 'ยืนยันอีเมลของคุณ', body: 'http://localhost:5173/verify-email?token=SECRET-TOKEN', kind: 'EMAIL_VERIFICATION' } as const;

describe('the SMTP sender (§107)', () => {
  it('authenticates and delivers a plain-text message from the configured sender', async () => {
    const server = await startServer();
    try {
      const result = await senderFor(server.port).send(message);

      expect(result).toEqual({ sent: true });
      expect(server.received).toHaveLength(1);
      expect(server.received[0]).toMatchObject({ from: USER, to: ['someone@example.test'] });
      expect(server.received[0]!.raw).toMatch(/Content-Type: text\/plain/i);
      expect(server.received[0]!.raw).not.toMatch(/text\/html/i);
    } finally {
      await server.close();
    }
  });

  it('refuses to send without TLS — a password never crosses the network in the clear', async () => {
    const server = await startServer({ disabledCommands: ['STARTTLS'], allowInsecureAuth: true });
    try {
      const result = await senderFor(server.port).send(message);

      // Not retryable: the server refuses STARTTLS every time, and only a configuration change helps.
      expect(result).toMatchObject({ sent: false, retryable: false });
      expect(server.received).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('treats a rejected recipient (5xx) as not retryable, and keeps the address out of the reason and the log', async () => {
    const server = await startServer({
      onRcptTo(address, _session, callback) {
        callback(Object.assign(new Error(`5.1.1 <${address.address}> user unknown`), { responseCode: 550 }));
      },
    });
    const warned: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((entry: unknown) => {
      warned.push(String(entry));
    });
    try {
      const result = await senderFor(server.port).send(message);

      expect(result).toMatchObject({ sent: false, retryable: false });
      const logged = [warned.join('\n'), result.sent ? '' : result.reason].join('\n');
      expect(logged).toContain('550');
      expect(logged).not.toContain('someone@example.test');
      expect(logged).not.toContain('SECRET-TOKEN');
    } finally {
      await server.close();
    }
  });

  it('treats a temporary refusal (4xx) as retryable', async () => {
    const server = await startServer({
      onRcptTo(_address, _session, callback) {
        callback(Object.assign(new Error('4.7.1 try again later'), { responseCode: 451 }));
      },
    });
    try {
      expect(await senderFor(server.port).send(message)).toMatchObject({ sent: false, retryable: true });
    } finally {
      await server.close();
    }
  });

  it('treats wrong credentials as not retryable — sending again cannot fix the configuration', async () => {
    const server = await startServer();
    try {
      expect(await senderFor(server.port, 'wrong-password').send(message)).toMatchObject({ sent: false, retryable: false });
    } finally {
      await server.close();
    }
  });

  it('treats an unreachable server as retryable, and never throws', async () => {
    const server = await startServer();
    const { port } = server;
    await server.close();

    const result = await senderFor(port).send(message);

    expect(result).toMatchObject({ sent: false, retryable: true });
  });

  it('logs the kind and nothing else on success — no recipient, subject, body or link', async () => {
    const server = await startServer();
    const logged: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((entry: unknown) => {
      logged.push(String(entry));
    });
    try {
      await senderFor(server.port).send(message);

      const all = logged.join('\n');
      expect(all).toContain('EMAIL_VERIFICATION');
      expect(all).not.toContain('someone@example.test');
      expect(all).not.toContain('SECRET-TOKEN');
      expect(all).not.toContain('ยืนยันอีเมล');
    } finally {
      await server.close();
    }
  });
});
