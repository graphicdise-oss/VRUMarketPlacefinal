import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../../common/errors/app-exception.js';
import { readSession } from '../authenticated-request.js';
import { REQUIRES_SUPER_ADMIN } from '../decorators/requires-super-admin.decorator.js';

/**
 * Enforces `@RequiresSuperAdmin()`.
 *
 * The role is read from the session AuthGuard resolved on this request, which came from the
 * database — so revoking somebody's super-admin role takes effect on their next request rather
 * than when their token expires. Same property as the ban check, for the same reason.
 *
 * Answers FORBIDDEN rather than NOT_FOUND for a signed-in caller who is not a super admin. Hiding
 * the existence of the admin routes would be worth something if they were guessable secrets; they
 * are `/admin/...` on a marketplace whose source is on GitHub.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<boolean>(REQUIRES_SUPER_ADMIN, [
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
      // Only reachable if a route is marked both @Public() and @RequiresSuperAdmin(), which is a
      // contradiction. Answering "sign in" is the truthful half of it.
      throw new AppException('UNAUTHENTICATED');
    }

    if (session.user.role !== 'SUPER_ADMIN') {
      throw new AppException('FORBIDDEN');
    }

    return true;
  }
}
