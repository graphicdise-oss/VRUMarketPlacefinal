import { readFileSync } from 'node:fs';
import { Test, type TestingModule } from '@nestjs/testing';

/**
 * §99: a deployment whose `.env` still carries `.env.example`'s placeholders must not start.
 *
 * Those placeholders are long enough to pass every length check, so before this a production
 * server copied from the example booted and worked — while anyone who had read the (public)
 * example could mint a session cookie for any account. The compose file builds DATABASE_URL from
 * POSTGRES_PASSWORD, so a forgotten database password arrives here too.
 *
 * Booting is the seam: configuration is validated when the application module is first loaded,
 * so each case loads a fresh copy of it under the environment it describes.
 */
const EXAMPLE = Object.fromEntries(
  readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
) as Record<string, string>;

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

async function bootWith(overrides: Record<string, string>, inspect?: (moduleRef: TestingModule) => Promise<void>): Promise<void> {
  Object.assign(process.env, overrides);
  vi.resetModules();
  // `ConfigModule.forRoot` is async and validates while the module is being declared, so a refusal
  // is a rejected promise sitting in the module's metadata until Nest compiles it. `main.ts` awaits
  // that straight away; here the promise is claimed first so the runner does not report the refusal
  // the test expects as an unhandled rejection.
  const { AppConfigModule } = await import('../src/config/app-config.module.js');
  for (const imported of Reflect.getMetadata('imports', AppConfigModule) as unknown[]) {
    if (imported instanceof Promise) {
      imported.catch(() => undefined);
    }
  }
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  try {
    await inspect?.(moduleRef);
  } finally {
    await moduleRef.close();
  }
}

/**
 * Values a real deployment would have — no placeholder anywhere.
 *
 * Every variable `.env.example` gives a placeholder is overridden here, POSTGRES_PASSWORD included:
 * the app also reads a `.env` in the working directory, and on a developer's machine that file was
 * copied from the example, so anything left out would arrive as a placeholder from there.
 */
function realLooking(): Record<string, string> {
  const secret = (label: string): string => `${label}-0123456789abcdef0123456789abcdef`;
  return {
    NODE_ENV: 'production',
    DATABASE_URL: original.DATABASE_URL!,
    POSTGRES_PASSWORD: secret('postgres'),
    ACCOUNT_MARKER_PEPPER: secret('pepper'),
    ACCESS_TOKEN_SECRET: secret('access'),
    REFRESH_TOKEN_SECRET: secret('refresh'),
    CSRF_SECRET: secret('csrf'),
    VERIFICATION_TOKEN_SECRET: secret('verification'),
    BREVO_API_KEY: 'xkeysib-0123456789abcdef',
    GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'GOCSPX-0123456789abcdef',
  };
}

describe('§99 — production refuses to start on the example’s placeholders', () => {
  it('a production boot with .env.example copied as is stops and names every placeholder', async () => {
    const boot = bootWith({ ...EXAMPLE, NODE_ENV: 'production', DATABASE_URL: original.DATABASE_URL! });

    const error = await boot.then(
      () => null,
      (thrown: unknown) => thrown as Error,
    );
    expect(error?.message).toMatch(/still the placeholder/);
    for (const name of [
      'ACCOUNT_MARKER_PEPPER',
      'ACCESS_TOKEN_SECRET',
      'REFRESH_TOKEN_SECRET',
      'CSRF_SECRET',
      'VERIFICATION_TOKEN_SECRET',
      'BREVO_API_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ]) {
      expect(error?.message).toContain(name);
    }
  });

  it('a database password left at the placeholder is caught through DATABASE_URL, without printing it', async () => {
    const url = new URL(original.DATABASE_URL!);
    url.password = 'replace-me-openssl-rand-hex-32';

    const error = await bootWith({ ...realLooking(), DATABASE_URL: url.toString() }).then(
      () => null,
      (thrown: unknown) => thrown as Error,
    );

    expect(error?.message).toContain('DATABASE_URL');
    expect(error?.message).not.toContain(url.toString());
  });

  it('the same values boot in development, where the example is meant to be copied', async () => {
    await expect(bootWith({ ...EXAMPLE, NODE_ENV: 'development', DATABASE_URL: original.DATABASE_URL! })).resolves.toBeUndefined();
  });

  it('a production environment with real values boots', async () => {
    await expect(bootWith(realLooking())).resolves.toBeUndefined();
  });
});

describe('§107 — EMAIL_TRANSPORT picks Brevo or SMTP, and only the chosen one’s settings are required', () => {
  const smtp = { EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.university.test', SMTP_PORT: '587', SMTP_USER: 'noreply@university.test', SMTP_PASSWORD: 'app-password-0123456789' };

  async function bootError(overrides: Record<string, string>): Promise<Error | null> {
    return bootWith(overrides).then(
      () => null,
      (thrown: unknown) => thrown as Error,
    );
  }

  it('boots on SMTP with the Brevo key still the example’s placeholder — it is not used', async () => {
    await expect(bootWith({ ...realLooking(), BREVO_API_KEY: EXAMPLE.BREVO_API_KEY!, ...smtp })).resolves.toBeUndefined();
  });

  it('refuses SMTP in production while its host is still the example’s — the password alone is not enough', async () => {
    const error = await bootError({ ...realLooking(), ...smtp, SMTP_HOST: EXAMPLE.SMTP_HOST! });

    expect(error?.message).toContain('SMTP_HOST');
  });

  it('refuses SMTP without a host, naming it', async () => {
    const error = await bootError({ ...realLooking(), ...smtp, SMTP_HOST: '' });

    expect(error?.message).toContain('SMTP_HOST');
  });

  it('refuses SMTP in production while its password is still the example’s placeholder — without printing it', async () => {
    const error = await bootError({ ...realLooking(), ...smtp, SMTP_PASSWORD: EXAMPLE.SMTP_PASSWORD! });

    expect(error?.message).toContain('SMTP_PASSWORD');
    expect(error?.message).not.toContain(EXAMPLE.SMTP_PASSWORD!);
  });

  it('boots on Brevo with the SMTP settings left at the example — they are not used', async () => {
    await expect(bootWith({ ...realLooking(), EMAIL_TRANSPORT: 'brevo', SMTP_PASSWORD: EXAMPLE.SMTP_PASSWORD! })).resolves.toBeUndefined();
  });

  it('binds the sender the setting names — nothing else in the application reaches either provider', async () => {
    const bound: string[] = [];
    // Imported inside the boot, after `vi.resetModules()`, so the classes are the ones this app instance uses.
    const inspectSender = async (moduleRef: TestingModule): Promise<void> => {
      const { EmailSender } = await import('../src/email/email-sender.js');
      bound.push(moduleRef.get(EmailSender).constructor.name);
    };

    await bootWith({ ...realLooking(), ...smtp }, inspectSender);
    await bootWith({ ...realLooking(), EMAIL_TRANSPORT: 'brevo' }, inspectSender);
    await bootWith(realLooking(), inspectSender);

    expect(bound).toEqual(['SmtpEmailSender', 'BrevoEmailSender', 'BrevoEmailSender']);
  });

  it('refuses a transport it does not know', async () => {
    const error = await bootError({ ...realLooking(), EMAIL_TRANSPORT: 'sendgrid' });

    expect(error?.message).toContain('EMAIL_TRANSPORT');
  });
});
