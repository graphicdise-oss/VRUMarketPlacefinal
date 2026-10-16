import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards, UseInterceptors } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { readSession } from '../auth/authenticated-request.js';
import { RateLimited } from '../auth/decorators/rate-limit.decorator.js';
import { AppException } from '../common/errors/app-exception.js';

/**
 * The check an upload route makes before its body is read: the caller's own claim on the thing the
 * upload is for (their order, their shop's product, a room they are in…). It calls the very method
 * the service itself calls first when the upload is stored — one definition of "may upload here",
 * asked twice, never a second copy of it.
 */
export type UploadPrecheck = (services: ModuleRef, userId: string, params: Readonly<Record<string, string>>) => Promise<unknown>;

const UPLOAD_PRECHECK = 'files:uploadPrecheck';

/**
 * §100: every upload route, declared once — the file interceptor, the per-account upload ceiling
 * (`'upload'` in rate-limit.policy.ts), and the pre-check above. Bundled so a new upload route
 * cannot take the interceptor and forget the other two.
 *
 * Guards run before interceptors, so both the ceiling and the pre-check answer before multer reads a
 * byte of the body. Before this, the body — up to 110MB of dispute evidence — was read in full and
 * only then did the service find there was no such order; §99 took the API down with exactly that.
 */
export function AcceptsUpload(options: { field: string; maxFiles?: number; check: UploadPrecheck }) {
  return applyDecorators(
    RateLimited('upload'),
    SetMetadata(UPLOAD_PRECHECK, options.check),
    UseGuards(UploadPrecheckGuard),
    UseInterceptors(options.maxFiles === undefined ? FileInterceptor(options.field) : FilesInterceptor(options.field, options.maxFiles)),
  );
}

@Injectable()
export class UploadPrecheckGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly services: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const check = this.reflector.get<UploadPrecheck | undefined>(UPLOAD_PRECHECK, context.getHandler());
    const request = context.switchToHttp().getRequest<Request>();
    const session = readSession(request);
    // Every upload route requires a signed-in account, and AuthGuard (global, first) has refused a
    // request without one before this runs — there is nobody to check a claim for.
    if (check !== undefined && session !== null) {
      const params = plainParams(request);
      // Guards run before pipes, so the routes' own ParseUUIDPipe has not seen these yet — and a
      // non-UUID reaching a `@db.Uuid` column is a Prisma error, i.e. a 500 anyone could produce at
      // will. Every upload route's parameters are ids; refused the way the pipe would refuse them.
      if (!Object.values(params).every((value) => isUUID(value))) {
        throw new AppException('VALIDATION_FAILED');
      }
      await check(this.services, session.user.id, params);
    }
    return true;
  }
}

/** Express 5 types a route parameter as `string | string[]` for wildcard segments; upload routes have none. */
function plainParams(request: Request): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(request.params).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
