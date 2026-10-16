import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.module.js';
import { attachSession, readSession } from '../authenticated-request.js';
import { ACCESS_TOKEN_COOKIE, clearSessionCookies, readCookie } from '../cookies.js';
import { IS_PUBLIC_ROUTE } from '../decorators/public.decorator.js';
import { SessionService } from '../session.service.js';

/**
 * Decides who every request belongs to, and refuses the ones that belong to nobody.
 *
 * Registered globally (see AuthModule), so the default is that a route needs a session and
 * `@Public()` is the visible exception. The opposite default — guard each controller — is what
 * CLAUDE.md rejects for the community-admin check in as many words, and for the same reason: a
 * controller has a day where it forgets, and the forgotten one is the route that mattered.
 *
 * **The account's state is read from the database on every request.** That is invariant 7, not an
 * implementation detail: a ban has to bite on the next request, and nothing carried inside a
 * token can say anything about now. It costs one indexed lookup, which is the price of being able
 * to stop someone.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      // #66: registered as APP_GUARD, this runs for *every* handler Nest manages, ChatGateway's
      // included — not just every controller. It has nothing to check there: `readCookie` above
      // reads an Express `Request`, which a websocket event has none of, and `ChatGateway` does
      // not inherit a silent pass by this returning `true` — it authenticates its own handshake
      // *and* re-checks the database before every single event (`ws-auth.ts`'s namespace
      // middleware, `requireLiveUser`), which is invariant 7/8 applied to a transport this guard
      // cannot read. Stepping aside here is what lets that mechanism run at all; throwing (an
      // earlier placeholder, before this ticket existed to resolve it) meant every chat event
      // failed before `ChatGateway` ever got a chance to authenticate it properly.
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const accessToken = readCookie(request, ACCESS_TOKEN_COOKIE);

    if (accessToken !== undefined) {
      const resolved = await this.sessions.resolveAccessToken(accessToken);

      if (resolved.status === 'banned') {
        // Refused even on a public route. Browsing does not need an account at all, so the
        // alternative — quietly treating a banned person as a guest — would mean their client
        // keeps believing it is signed in and finds out one failed action at a time. A banned
        // person can still browse; they do it without these cookies, which is what the
        // frontend does about this code (see FRONTEND-NOTES).
        //
        // Which is why the cookies go out with the refusal rather than being left for the client
        // to drop: they are httpOnly, so the frontend's documented reaction ("clear client state
        // and keep browsing") is something JavaScript physically cannot carry out, and the one
        // endpoint that would clear them — POST /auth/logout — is refused right here, by this
        // same check, before it can run. Without this the account is not merely banned: every
        // request the browser makes, public product pages included, answers 403 until the access
        // cookie reaches its own max-age. The session row is revoked already (#29 revokes all of
        // them when it bans), so nothing of value is being thrown away.
        clearSessionCookies(
          context.switchToHttp().getResponse<Response>(),
          this.config.isProduction,
        );

        throw new AppException('ACCOUNT_BANNED');
      }

      if (resolved.status === 'valid') {
        attachSession(request, resolved.session);
      }
      // 'invalid' — expired, revoked by a logout, or never ours — is treated exactly as if no
      // cookie had been sent. The client's answer is the same in every case: refresh, and if that
      // fails, sign in.
    }

    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    if (!isPublic && readSession(request) === null) {
      throw new AppException('UNAUTHENTICATED');
    }

    return true;
  }
}
