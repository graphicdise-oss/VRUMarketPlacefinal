import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { IncomingMessage } from 'node:http';
import type { Server, ServerOptions } from 'socket.io';
import { AppConfig } from '../config/app-config.module.js';

/**
 * The socket.io CORS origin has to come from `AppConfig` (`.env`'s `FRONTEND_BASE_URL`), the
 * same value `bootstrap.ts` gives `app.enableCors()` for HTTP — but `@WebSocketGateway()`'s
 * decorator options are evaluated at class-definition time, before Nest's DI container exists,
 * so there is no way to inject `AppConfig` into them directly.
 *
 * `IoAdapter.create()` calls `createIOServer(port, options)` once, when the gateway's underlying
 * `Server` is actually constructed — by which point `app` (passed to this adapter's constructor
 * in `bootstrap.ts`) can resolve `AppConfig`. Overriding just this one method is the documented
 * NestJS extension point for exactly this problem, and it keeps the reasoning in one place
 * instead of a `cors` object mutated after construction — socket.io builds its CORS middleware
 * once from the options given to its constructor (see `node_modules/socket.io/dist/index.js`)
 * and never reads it again, so a later mutation would silently do nothing.
 *
 * ⚠️ Mirrors `bootstrap.ts`'s own warning: never widen this to `origin: true` or a reflected
 * origin. `credentials: true` means a wildcard is rejected by the browser anyway, but a reflected
 * origin would hand any page's script a socket that carries this system's session cookies.
 */
export class ChatIoAdapter extends IoAdapter {
  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const config = this.app.get(AppConfig);

    // `ServerOptions`' own properties (e.g. `path`) are typed as required, even though socket.io
    // fills every one of them in with a default when omitted — spreading a possibly-partial
    // `options` is exactly the documented way to use this API, so the cast below states what is
    // already true at runtime rather than working around a real gap.
    const merged = {
      ...options,
      cors: { origin: config.frontendBaseUrl, credentials: true },
      allowRequest: (request: IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void) => {
        callback(null, isAllowedHandshakeOrigin(request.headers.origin, config.frontendBaseUrl));
      },
    } as ServerOptions;

    return super.createIOServer(port, merged);
  }
}

/**
 * Code review of topic 11 (§83): the Origin check `cors` never was.
 *
 * `cors` above only shapes the response headers of the long-polling transport — a browser does not
 * apply CORS to a WebSocket upgrade at all, and socket.io's cors middleware never refuses a request
 * anyway. Until this, a page on *any* origin could open `/chat` with the visitor's cookies, and the
 * only thing standing in the way was `SameSite=Lax`, which is same-*site*, not same-origin: a page
 * on a sibling subdomain was let straight in and could read and send messages as the visitor
 * (verified: `Origin: https://evil-sibling.example` connected and listed rooms). This is the
 * WebSocket's half of invariant 9's "ต้องมี CSRF token คู่กัน" — a socket.io event has nowhere to
 * carry a CSRF header, so the handshake's Origin is where a forged connection is refused.
 *
 * A request with no Origin at all is allowed: every browser sends one on a WebSocket handshake and
 * on any cross-origin request, so a missing header means a same-origin polling request or a
 * non-browser client — and a non-browser client holding the cookie already has the cookie, which
 * is not what CSRF protects against.
 */
export function isAllowedHandshakeOrigin(origin: string | undefined, frontendBaseUrl: string): boolean {
  return origin === undefined || origin === new URL(frontendBaseUrl).origin;
}
