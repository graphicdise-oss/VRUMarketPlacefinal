import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountMarkerRetentionSweepTask } from './account-marker-retention.sweep-task.js';
import { AccountMarkerService } from './account-marker.service.js';
import {
  RateLimitSweepTask,
  SessionSweepTask,
  VerificationTokenSweepTask,
} from './auth-sweep.tasks.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CsrfService } from './csrf.service.js';
import { EmailVerificationController } from './email-verification.controller.js';
import { EmailVerificationService } from './email-verification.service.js';
import { GoogleAuthController } from './google-auth.controller.js';
import { GoogleAuthService } from './google-auth.service.js';
import { GoogleIdentity } from './google-identity.js';
import { GoogleOAuthClient } from './google-oauth.client.js';
import { AuthGuard } from './guards/auth.guard.js';
import { CsrfGuard } from './guards/csrf.guard.js';
import { RateLimitGuard } from './guards/rate-limit.guard.js';
import { SuperAdminGuard } from './guards/super-admin.guard.js';
import { VerifiedEmailGuard } from './guards/verified-email.guard.js';
import { PasswordResetController } from './password-reset.controller.js';
import { PasswordResetService } from './password-reset.service.js';
import { RateLimitPolicy } from './rate-limit.policy.js';
import { RateLimitService } from './rate-limit.service.js';
import { SessionRevocations } from './session-revocations.js';
import { SessionService } from './session.service.js';
import { VerificationTokenService } from './verification-token.service.js';

/**
 * Identity, sessions, and proving an address belongs to whoever registered it.
 *
 * The five guards are registered as APP_GUARD, which applies them to every route in the
 * application — including routes in modules that know nothing about this one. That is the point:
 * authentication is default-deny (see the `@Public()` decorator) and CSRF has no exemption list, so
 * a controller written in topic 7 is protected before its author has thought about it.
 *
 * **Order matters.** Nest runs APP_GUARD providers in the order they are declared here.
 *
 *   1. AuthGuard resolves the session, so the two below have one to read — and so that a
 *      protected route with an expired token answers 401 ("refresh") rather than 403 ("your CSRF
 *      token is wrong"), which would send the frontend to fix the wrong thing.
 *   2. CsrfGuard, before any handler can act on a forged request.
 *   3. RateLimitGuard (#28), opt-in per route via `@RateLimited`. After CSRF so that a forged
 *      request cannot spend somebody else's allowance, and before the handler so that the
 *      expensive part of a request — argon2 at 19 MiB — is what the ceiling protects.
 *   4. VerifiedEmailGuard and SuperAdminGuard, both opt-in per route and both reading the session
 *      resolved in 1. Their order relative to each other does not matter: no route carries both,
 *      and if one ever did, either answer would be correct.
 *
 * Registered here rather than in bootstrap.ts because these guards inject services, which a guard
 * passed to `app.useGlobalGuards` cannot do.
 */
@Module({
  controllers: [
    AuthController,
    EmailVerificationController,
    GoogleAuthController,
    PasswordResetController,
  ],
  providers: [
    AuthService,
    SessionService,
    SessionRevocations,
    CsrfService,
    VerificationTokenService,
    EmailVerificationService,
    AccountMarkerService,
    GoogleAuthService,
    PasswordResetService,
    // Bound here and nowhere else, exactly like EmailSender in EmailModule: no service in this
    // codebase mentions Google's endpoints, and the suite swaps this one token for a fake.
    { provide: GoogleIdentity, useClass: GoogleOAuthClient },
    RateLimitPolicy,
    RateLimitService,
    SessionSweepTask,
    VerificationTokenSweepTask,
    RateLimitSweepTask,
    AccountMarkerRetentionSweepTask,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
  ],
  // SessionService for topic 11, which authenticates a websocket handshake from the same cookies
  // (B3) and must not grow its own notion of what a valid session is. CsrfService for anything
  // that needs to mint a token outside this controller. VerificationTokenService for #27, which
  // issues password-reset links from the same table. SessionService again for AdminModule, which
  // ends every session when it bans somebody. AccountMarkerService for topic 12, which writes the
  // markers this only reads, and for ShopModule (§97), which shows their dispute count to shop reviewers. RateLimitService for #67, which counts a room's messages-per-minute
  // directly (L7) rather than through RateLimitGuard/RateLimitPolicy — those are shaped around an
  // HTTP `Request` (an IP, a body's `email`, a `Response` to set `Retry-After` on) and a chat
  // event has none of the three.
  exports: [SessionService, SessionRevocations, CsrfService, VerificationTokenService, AccountMarkerService, RateLimitService],
})
export class AuthModule {}
