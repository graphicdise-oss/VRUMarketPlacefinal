import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { readSession } from '../../auth/authenticated-request.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ADMIN_ACCOUNT_REFUSED, isAnyAdmin } from '../community-admin-scope.js';
import { REFUSES_ADMINS } from '../decorators/refuses-admins.decorator.js';

/**
 * Enforces `@RefusesAdmins()` (§85, N29). Registered globally by `CommunityModule` after
 * `CommunityScopeGuard`, and a no-op on every route without the decorator. Reads the caller's
 * admin standing live from the database on every request — the same "never a cached flag"
 * reasoning invariant 7 gives bans: an account made admin a second ago is refused here now.
 */
@Injectable()
export class AdminAccountGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const refuses = this.reflector.getAllAndOverride<boolean>(REFUSES_ADMINS, [context.getHandler(), context.getClass()]) ?? false;
    if (!refuses) {
      return true;
    }
    if (context.getType() !== 'http') {
      return false;
    }

    const session = readSession(context.switchToHttp().getRequest<Request>());
    if (session === null) {
      // Unreachable: no route pairs @Public() with @RefusesAdmins(), so AuthGuard already refused.
      throw new AppException('UNAUTHENTICATED');
    }

    if (await isAnyAdmin(this.prisma, session.user.id, session.user.role)) {
      throw new AppException('FORBIDDEN', {
        message: ADMIN_ACCOUNT_REFUSED,
      });
    }

    return true;
  }
}
