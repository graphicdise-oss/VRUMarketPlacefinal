import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/** §107: how email leaves the system — Brevo's API, or an SMTP account (a university mail system). */
export const EMAIL_TRANSPORTS = ['brevo', 'smtp'] as const;
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];

/** §107: the settings each transport reads — the other transport's are neither required nor checked for placeholders. */
const TRANSPORT_SETTINGS: Record<EmailTransport, readonly string[]> = {
  brevo: ['BREVO_API_KEY'],
  smtp: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'],
};

/** §128: Google sign-in is on when either half of the client is set — and then both must be. */
function googleSignInConfigured(env: EnvVars): boolean {
  return env.GOOGLE_CLIENT_ID !== '' || env.GOOGLE_CLIENT_SECRET !== '';
}

const GOOGLE_PAIR_MESSAGE =
  'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or leave both empty to turn signing in with Google off';

/**
 * Every environment variable the application reads, validated once at boot.
 *
 * CLAUDE.md requires that a missing required variable stops the boot and names what is
 * missing, rather than surfacing as a confusing failure on the first request that happens
 * to need it. `validateEnv` below is wired into ConfigModule so that is what happens.
 *
 * Secrets have a minimum length because "" and "changeme" both satisfy @IsString, and an
 * empty signing key is worse than no signing at all: it looks configured.
 *
 * Keep this class and `.env.example` in step. The list originates from the env-var table
 * in issue #2.
 */
export class EnvVars {
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  /**
   * Note the explicit `: number`. Environment variables arrive as strings, and
   * class-transformer's implicit conversion relies on the type the decorator metadata
   * records for the property. With a bare `PORT = 3000` the emitted type is `Object`, not
   * `Number`, so nothing converts and `@IsInt` rejects the string it was handed — which
   * looks exactly like a misconfigured .env. Annotate every numeric variable.
   */
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Postgres connection string. Also read by the Prisma CLI via prisma.config.ts. */
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  /**
   * Seed reads this to create or promote the first super admin (K2). The seed must be
   * safe to re-run, so this is an identity to look up, not a row to insert blindly.
   */
  @IsEmail()
  SUPER_ADMIN_EMAIL!: string;

  /**
   * Pepper for the HMAC in DeletedAccountMarker (K16).
   *
   * ⚠️ This value can never be rotated. Markers are the only trace left of an erased
   * account, and they store HMAC(email, pepper) with no way to recompute the old digests —
   * change the pepper and every previously banned person can register again. It must also
   * never be stored in the database, or erasing the database would also erase the pepper
   * that gives the markers meaning.
   */
  @IsString()
  @MinLength(32)
  ACCOUNT_MARKER_PEPPER!: string;

  /** Signing key for the access-token cookie (B3). Short-lived tokens, httpOnly cookie. */
  @IsString()
  @MinLength(32)
  ACCESS_TOKEN_SECRET!: string;

  /** Signing key for the refresh-token cookie (B3). Separate key from the access token. */
  @IsString()
  @MinLength(32)
  REFRESH_TOKEN_SECRET!: string;

  /** Signing key for the CSRF token that pairs with the httpOnly cookies (B3). */
  @IsString()
  @MinLength(32)
  CSRF_SECRET!: string;

  /**
   * Signing key for the single-use links sent by email — verification (#25) and password
   * reset (#27).
   *
   * A fourth key rather than a reuse of one above, on the same principle: a link in an inbox is a
   * temporary password for that account, and a value minted for one purpose must not be presentable
   * as another. Rotating it invalidates every link already in flight, which costs people one
   * "resend" and is otherwise safe.
   */
  @IsString()
  @MinLength(32)
  VERIFICATION_TOKEN_SECRET!: string;

  /**
   * Directory backing the upload Docker volume (K1).
   *
   * ⚠️ Never concatenate user input onto this path. Uploads are addressed by an opaque id
   * and resolved server-side; see the upload helper that arrives with topic 4 (N1).
   */
  @IsString()
  @IsNotEmpty()
  UPLOAD_DIR!: string;

  /**
   * The one size ceiling every image upload obeys (#36 · K1) — the product-photo cap C4 names
   * (10MB), reused rather than duplicated because the file-storage helper is shared and a second
   * ceiling nobody agreed on would just be a second number to keep in sync with this one.
   */
  @IsInt()
  @Min(1)
  MAX_IMAGE_UPLOAD_BYTES: number = 10 * 1024 * 1024;

  /**
   * §100: where an upload waits on disk while its request lasts — never in memory, where twelve
   * simultaneous dispute uploads (10 × 10MB each) were enough to get the process killed. Deleted as
   * the response closes. Outside UPLOAD_DIR on purpose: that volume holds only files that were
   * validated and re-encoded, and is what the backup covers.
   */
  @IsString()
  @IsNotEmpty()
  UPLOAD_TMP_DIR: string = join(tmpdir(), 'vru-marketplace-upload-scratch');

  /**
   * §100: how many images are decoded and re-encoded at once, system-wide. Each one holds its
   * source file and sharp's working memory; the ceiling is what keeps a burst of uploads from
   * adding up past the container's memory limit. Measured in §99: one full dispute ≈ 200MiB above
   * idle, so 2 fits the 1g default with room for everything else.
   */
  @IsInt()
  @Min(1)
  @Max(16)
  IMAGE_PROCESSING_CONCURRENCY: number = 2;

  /**
   * §100: how long an upload waits for a processing slot before it is answered 503 with
   * Retry-After. Below Nginx's 60s proxy timeout with room for the processing itself, so the
   * caller hears "try again" from the API rather than a bare 504 from the proxy. 0 = never wait.
   */
  @IsInt()
  @Min(0)
  IMAGE_PROCESSING_QUEUE_TIMEOUT_MS: number = 20_000;

  /**
   * §107 (the owner's choice): Brevo or SMTP, both behind the one `EmailSender` interface (A4).
   * Defaults to Brevo, what every deployment so far was configured for.
   */
  @IsIn(EMAIL_TRANSPORTS)
  EMAIL_TRANSPORT: EmailTransport = 'brevo';

  /** Brevo API key (A4). Required only when `EMAIL_TRANSPORT=brevo`. */
  @ValidateIf((env: EnvVars) => env.EMAIL_TRANSPORT === 'brevo')
  @IsString()
  @IsNotEmpty()
  BREVO_API_KEY!: string;

  /** §107: the SMTP server — required only when `EMAIL_TRANSPORT=smtp`. */
  @ValidateIf((env: EnvVars) => env.EMAIL_TRANSPORT === 'smtp')
  @IsString()
  @IsNotEmpty()
  SMTP_HOST!: string;

  /**
   * 465 is TLS from the first byte; any other port (587 above all) must upgrade with STARTTLS before
   * the password is sent — the sender refuses a server that will not.
   */
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number = 587;

  @ValidateIf((env: EnvVars) => env.EMAIL_TRANSPORT === 'smtp')
  @IsString()
  @IsNotEmpty()
  SMTP_USER!: string;

  /** An app password or the account's own — a secret like any other here. */
  @ValidateIf((env: EnvVars) => env.EMAIL_TRANSPORT === 'smtp')
  @IsString()
  @IsNotEmpty()
  SMTP_PASSWORD!: string;

  @IsEmail()
  MAIL_FROM_ADDRESS!: string;

  @IsString()
  @IsNotEmpty()
  MAIL_FROM_NAME!: string;

  /**
   * Public base URL of the frontend, used to build the links in verification and
   * password-reset emails (I16 · B0.1). The real domain is still undecided (issue #20),
   * which is why this is configuration rather than a constant.
   */
  @IsUrl({ require_tld: false, require_protocol: true })
  FRONTEND_BASE_URL!: string;

  /** OAuth client id from Google Cloud Console (#26). Public by design — it appears in the URL. */
  @ValidateIf(googleSignInConfigured)
  @IsString()
  @IsNotEmpty({ message: GOOGLE_PAIR_MESSAGE })
  GOOGLE_CLIENT_ID: string = '';

  /**
   * OAuth client secret (#26).
   *
   * ⚠️ Never reaches a browser. The whole point of the redirect flow in google-auth.controller.ts
   * is that the code-for-token exchange happens server to server, so this value lives in this
   * process and nowhere else.
   */
  @ValidateIf(googleSignInConfigured)
  @IsString()
  @IsNotEmpty({ message: GOOGLE_PAIR_MESSAGE })
  GOOGLE_CLIENT_SECRET: string = '';

  /**
   * The callback this backend serves, registered as an authorised redirect URI in Google Cloud
   * Console. It must match there **character for character** — Google compares the string.
   *
   * Configuration rather than something derived from FRONTEND_BASE_URL, because it points at the
   * API and not at the frontend: `https://host/api/v1/auth/google/callback`. The two are the same
   * host in the planned deployment and are not the same host in development.
   */
  @IsUrl({ require_tld: false, require_protocol: true })
  GOOGLE_REDIRECT_URI!: string;

  /**
   * How many reverse proxies sit in front of this process (#28).
   *
   * Every rate limit is counted per source address, and behind Nginx `request.ip` is Nginx unless
   * Express is told to read `X-Forwarded-For`. Left at 0, the entire site shares one counter and
   * the first busy minute locks everybody out — the exact opposite of what the limits are for.
   *
   * ⚠️ A hop count, not a boolean, because `X-Forwarded-For` is a header a client can write. Set
   * it to the number of proxies you actually run — the deployment in CLAUDE.md is one Nginx, so 1
   * — and Express takes the address that many hops from the right, which a client cannot forge.
   * Setting it higher than the truth lets callers choose their own address, and with it their own
   * allowance.
   */
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY_HOPS: number = 1;

  /**
   * The rate-limit ceilings (I17 · L7).
   *
   * Configuration rather than constants because #28 requires it, and the reason it requires it is
   * worth repeating: this project has no CI and none of these numbers has met real traffic, so the
   * first one that turns out to be wrong needs changing on the server rather than in a rebuild.
   * The defaults are the numbers I17 and L7 give, except where noted in rate-limit.policy.ts.
   */
  @IsInt()
  @Min(1)
  RATE_LIMIT_LOGIN_PER_15_MIN: number = 10;

  /** ⚠️ Invented, not from I17 or L7 — see `loginPerIp` in rate-limit.policy.ts. */
  @IsInt()
  @Min(1)
  RATE_LIMIT_LOGIN_PER_IP_PER_HOUR: number = 60;

  @IsInt()
  @Min(1)
  RATE_LIMIT_REGISTER_PER_HOUR: number = 5;

  /** ⚠️ Invented, not from I17 or L7 — see `registerPerIp` in rate-limit.policy.ts. */
  @IsInt()
  @Min(1)
  RATE_LIMIT_REGISTER_PER_IP_PER_HOUR: number = 20;

  @IsInt()
  @Min(1)
  RATE_LIMIT_EMAIL_LINK_PER_HOUR: number = 3;

  /** ⚠️ Invented as well: a guard on argon2's cost, not on guessing a 256-bit token. */
  @IsInt()
  @Min(1)
  RATE_LIMIT_PASSWORD_RESET_PER_IP_PER_HOUR: number = 20;

  /**
   * #67 (L7): 30 messages a minute, per room — not the `RateLimitPolicy`/`RateLimitGuard` machine
   * the rules above go through, because that machine is HTTP-shaped end to end (keyed by
   * `request.ip` plus a body's `email`, refused with a `Response` header). A chat event has
   * neither; see `ChatService`'s own comment for why it calls `RateLimitService.consume` directly
   * instead.
   */
  @IsInt()
  @Min(1)
  RATE_LIMIT_CHAT_MESSAGE_PER_MINUTE: number = 30;

  /** §100: uploads per account per hour, every upload route together (owner's call, 2026-09-29). */
  @IsInt()
  @Min(1)
  RATE_LIMIT_UPLOAD_PER_HOUR: number = 60;
}

/**
 * Turns the raw process environment into a validated EnvVars instance.
 *
 * Thrown errors here happen before the HTTP server listens, so the message is for whoever
 * is starting the app — it lists every missing or malformed variable at once rather than
 * failing on the first one, because fixing a .env one variable per restart is miserable.
 */
export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const env = plainToInstance(EnvVars, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(env, { skipMissingProperties: false, whitelist: false });

  const problems = errors.map((error) => {
    const reasons = Object.values(error.constraints ?? {}).join(', ');
    return `  - ${error.property}: ${reasons || 'invalid value'}`;
  });
  if (env.NODE_ENV === 'production') {
    problems.push(...placeholdersIn(env).map((name) => `  - ${name}: still the placeholder from .env.example`));
  }

  if (problems.length > 0) {
    const details = problems.sort().join('\n');

    throw new Error(
      `Environment is not usable, so the application will not start.\n${details}\n` +
        'Copy .env.example to .env and fill it in. Values in .env.example are placeholders, not real secrets.',
    );
  }

  return env;
}

/**
 * Every placeholder in `.env.example` contains this marker, and the docker compose file carries
 * POSTGRES_PASSWORD into DATABASE_URL, so a forgotten database password is caught here as well.
 */
const PLACEHOLDER_MARKER = 'replace-me';

/**
 * §99: the names — never the values — of variables still holding `.env.example`'s placeholders.
 *
 * Production only. The placeholders are long enough to pass every check above, so without this a
 * server set up by copying the example boots and works, while anyone who has read that public file
 * can sign a session cookie for any account. In development the example is meant to be copied.
 */
function placeholdersIn(env: EnvVars): string[] {
  // §107: the transport not in use keeps whatever the example gave it — nothing ever reads it.
  const unused = new Set(EMAIL_TRANSPORTS.filter((transport) => transport !== env.EMAIL_TRANSPORT).flatMap((transport) => TRANSPORT_SETTINGS[transport]));

  return Object.entries(env)
    .filter(([name, value]) => !unused.has(name) && typeof value === 'string' && value.includes(PLACEHOLDER_MARKER))
    .map(([name]) => name);
}
