import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../../common/errors/app-exception.js';
import { readSession } from '../authenticated-request.js';
import { REQUIRES_VERIFIED_EMAIL } from '../decorators/requires-verified-email.decorator.js';

/**
 * Enforces `@RequiresVerifiedEmail()`.
 *
 * Runs after AuthGuard, so the session it reads has already been resolved from the database on
 * this request — which means an address verified a second ago is verified here, without waiting
 * for a token to expire.
 *
 * Registered globally like the other two rather than applied per controller with `@UseGuards`.
 * The decorator is the opt-in; where the guard runs is not something each module should decide,
 * for the same reason CLAUDE.md gives about the community-admin check: a controller that arranges
 * its own guards is a controller that one day forgets one.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<boolean>(REQUIRES_VERIFIED_EMAIL, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    if (!required) {
      return true;
    }

    if (context.getType() !== 'http') {
      return false;
    }

    const session = readSession(context.switchToHttp().getRequest<Request>());

    if (session === null) {
      // Reachable only if a route is marked both @Public() and @RequiresVerifiedEmail(), which is
      // a contradiction: there is no address to have verified. Answering "sign in first" is the
      // truthful half of it.
      throw new AppException('UNAUTHENTICATED');
    }

    if (!session.user.emailVerified) {
      throw new AppException('EMAIL_NOT_VERIFIED');
    }

    return true;
  }
}
