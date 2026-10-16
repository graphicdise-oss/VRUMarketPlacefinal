import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../../common/errors/app-exception.js';
import { csrfBindingFor } from '../csrf-binding.js';
import { CSRF_HEADER, CsrfService } from '../csrf.service.js';
import { SessionService } from '../session.service.js';

/**
 * Every request that changes data must carry the CSRF token for its session (B3).
 *
 * Registered globally after AuthGuard, so by the time this runs the session — if the access token
 * was valid — has already been resolved and can be used as the binding.
 *
 * **No route is exempt, including the public ones.** Registering and signing in change data too,
 * and the uniform rule is worth more than the round trip it costs: an exemption list is a list
 * someone adds to, and the entry that matters is the one added without thinking. For a caller who
 * is not signed in the token is bound to nothing, so it proves only that they fetched it from us —
 * which, because a custom header forces a CORS preflight that only the configured frontend
 * survives, is already what stops a cross-site page from posting here.
 *
 * ⚠️ This guard is not the main defence and must not be treated as if it were. The cookies are
 * `SameSite=Lax`, so a browser does not attach them to a cross-site POST in the first place, and
 * the CORS allowlist refuses the preflight. Those two are load-bearing; see csrf.service.ts.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly csrf: CsrfService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      // #66: reachable now that AuthGuard steps aside for a websocket context instead of
      // refusing it outright (see that guard's own comment). CSRF exists to stop a browser from
      // being tricked into sending *this session's cookie* to us from a page we did not serve —
      // and for a WebSocket handshake that is already covered by the same two mechanisms
      // csrf.service.ts calls load-bearing for HTTP: `SameSite=Lax` withholds the cookie from a
      // cross-site connection attempt in the first place (a handshake is not a top-level
      // navigation), and `ChatIoAdapter`'s `allowRequest` refuses a handshake whose Origin is not
      // the configured frontend (§83 — its `cors` option alone never did: browsers do not apply
      // CORS to a WebSocket upgrade, so until then a same-site sibling origin was let straight
      // in). A `CSRF_HEADER` has nowhere to live in a socket.io event anyway. Returning
      // `false` here (an earlier placeholder, written before AuthGuard could ever hand this
      // context off) produced Nest's generic Forbidden rather than this project's error shape —
      // exactly the "second format for sockets" L4 forbids.
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) {
      // A GET must not change anything, so there is nothing to forge. Anything not on this
      // short list is treated as unsafe, including methods nobody has thought of.
      return true;
    }

    const presented = request.headers[CSRF_HEADER];

    if (typeof presented !== 'string') {
      // Missing, or sent twice and parsed as an array. Both are "no token": taking the first of
      // two values would let a caller append a valid token to a forged one.
      throw new AppException('CSRF_FAILED');
    }

    const binding = await csrfBindingFor(request, this.sessions);

    if (!this.csrf.verify(presented, binding)) {
      throw new AppException('CSRF_FAILED');
    }

    return true;
  }
}

/** The methods RFC 9110 defines as safe. Everything else needs a token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
