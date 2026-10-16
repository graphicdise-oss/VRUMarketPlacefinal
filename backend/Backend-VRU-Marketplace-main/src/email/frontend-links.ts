import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.module.js';

/**
 * Builds the links that go inside emails.
 *
 * Separate from the sender because the domain is configuration, not a constant: there is no real
 * domain yet (issue #20 — and SPF/DKIM have to be set up on it before any of these emails reach an
 * inbox rather than a spam folder). Hardcoding one would mean every email in staging pointing at
 * production, or the reverse.
 *
 * Centralised for a second reason: these URLs carry single-use tokens. A link assembled by string
 * concatenation in five modules is five chances to forget to encode the token, and a token that
 * breaks on a `+` is a verification email that silently does not work.
 */
@Injectable()
export class FrontendLinks {
  constructor(private readonly config: AppConfig) {}

  /** Where the verification email points. The token is single-use (topic 2 owns its lifetime). */
  emailVerification(token: string): string {
    return this.build('/verify-email', { token });
  }

  /** Where the password-reset email points. Valid one hour, single use (I16). */
  passwordReset(token: string): string {
    return this.build('/reset-password', { token });
  }

  /**
   * Where Google's callback sends the browser once the backend has finished with it (#26).
   *
   * Not a link in an email — the only one here that is not — but it belongs to the same problem:
   * it is a frontend URL assembled from configuration, and the alternative is a template string in
   * the controller that drops the sub-path on a deployment under `/app` exactly as described
   * below. One page for both outcomes, with `?error=` when there was one, so the frontend has a
   * single route to write rather than two that must stay in step.
   */
  afterGoogleSignIn(error?: string): string {
    return this.build('/auth/google/complete', error === undefined ? {} : { error });
  }

  /** A buyer's or shop's own order page, for deadline warnings and status changes. */
  order(orderId: string): string {
    return this.build(`/orders/${encodeURIComponent(orderId)}`);
  }

  /**
   * Joins the configured base URL with a path.
   *
   * `new URL` rather than template strings: `searchParams` percent-encodes the token, which
   * concatenation gets wrong eventually, and the symptom is a link that looks right and does not
   * work.
   *
   * Both normalisations below are needed, and each fixes a different way the sub-path disappears:
   * a leading `/` on the path makes it absolute and replaces the base's path entirely, and a base
   * without a trailing slash has its last segment treated as a filename and dropped. Get either
   * wrong and a deployment under `https://host/app` sends links to `https://host/verify-email`.
   */
  private build(path: string, query: Record<string, string> = {}): string {
    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relativePath, ensureTrailingSlash(this.config.frontendBaseUrl));

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }
}

/**
 * Without this, `new URL('/verify-email', 'https://x.test/app')` drops `/app` — because a base
 * without a trailing slash treats its last segment as a file. A deployment under a sub-path would
 * get links missing the prefix.
 */
function ensureTrailingSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}
