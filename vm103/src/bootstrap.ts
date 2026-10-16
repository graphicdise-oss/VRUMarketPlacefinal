import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express, Request, Response } from 'express';
import { accessLogMiddleware } from './access-log/access-log.middleware.js';
import { AccessLogService } from './access-log/access-log.service.js';
import { CSRF_HEADER } from './auth/csrf.service.js';
import { ChatIoAdapter } from './chat/chat-io.adapter.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { AppException } from './common/errors/app-exception.js';
import { toErrorPayload } from './common/errors/error-payload.js';
import { RETRY_AFTER_HEADER } from './common/errors/retry-after.js';
import { validationExceptionFactory } from './common/errors/validation-exception-factory.js';
import { AppConfig } from './config/app-config.module.js';
import { discardUploadScratch } from './files/upload-scratch.js';
import { Clock } from './time/clock.js';

/**
 * Brings an app all the way up: configure, initialise, then finalise, in that order.
 *
 * **Both boot paths must call this and nothing else.** `main.ts` and the test helper used to
 * call `configureApp` and `finalizeApp` themselves, and they got the order wrong in opposite
 * ways: the test initialised before finalising, production finalised before Express had Nest's
 * router mounted. The result was a catch-all 404 handler registered ahead of every route, so the
 * real server answered 404 for /api/v1/health while the entire test suite passed.
 *
 * That is the failure mode seam 1 exists to prevent, and it slipped through because the two
 * paths each did their own sequencing. There is now one sequence, defined here.
 */
export async function initialiseApp(app: INestApplication): Promise<void> {
  configureApp(app);
  // Routes are registered on the underlying Express instance during init. Anything that has to
  // sit behind every route — the not-found handler — can only be added afterwards.
  await app.init();
  finalizeApp(app);
}

/**
 * Settings that must be in place before the container initialises.
 *
 * Exported for clarity rather than for direct use: call `initialiseApp`.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfig);

  // Both tokens arrive as cookies (B3), so something has to parse the Cookie header. Express does
  // not do it on its own, and `request.cookies` is undefined without this — which looks exactly
  // like a browser that is not sending the cookie.
  //
  // Here rather than as module middleware because it is not only the auth module's concern:
  // topic 11's websocket handshake reads the same cookies from the same upgrade request.
  app.use(cookieParser());

  // §98: traffic data for พ.ร.บ.คอมพิวเตอร์ ม.26 — mounted on Express itself rather than as Nest
  // middleware so that every request is logged, a 404 or a request a guard refuses included.
  app.use(accessLogMiddleware(app.get(AccessLogService), app.get(Clock)));

  // §100: uploads wait on disk while their request lasts (FilesModule) — this deletes them once the
  // response has closed, whichever way the request ended. Here, ahead of every route, because the
  // handler is exactly what does not run when validation refuses an upload.
  app.use(discardUploadScratch);

  // #66: the underlying socket.io `Server` for `ChatGateway` (the system's one WebSocket
  // feature) is constructed inside `app.init()`, below — this has to be set before that call.
  // `ChatIoAdapter` exists only to give that `Server` its CORS origin from `AppConfig`, which
  // `@WebSocketGateway()`'s own decorator options cannot reach (see that file's comment).
  app.useWebSocketAdapter(new ChatIoAdapter(app));

  // Every rate limit in #28 is counted per source address, and behind Nginx `request.ip` is Nginx
  // unless Express is told how far to look into `X-Forwarded-For`. Without this the whole site
  // shares one counter and the first busy minute locks everybody out — a limiter that produces
  // exactly the outage it exists to prevent.
  //
  // ⚠️ A hop count, not `true`. `X-Forwarded-For` is a header any client can write, so trusting
  // the whole chain lets callers choose their own address and with it their own allowance.
  // TRUST_PROXY_HOPS is the number of proxies actually in front of this process (1 for the Nginx
  // in CLAUDE.md); Express then takes the address that many hops from the right, which a client
  // cannot reach. Setting it too high is a silent way to disable every limit.
  app.get(HttpAdapterHost).httpAdapter.getInstance<Express>().set('trust proxy', config.trustProxyHops);

  // The frontend is a separate application on another origin, so without this the browser
  // refuses every call and nobody can sign in. `credentials` is what allows the cookies to be
  // sent at all; an allowlist with credentials enabled may not be a wildcard, and the browser
  // enforces that.
  //
  // ⚠️ **Never replace this with `origin: true` or a reflected origin.** A custom request header
  // forces a CORS preflight, and the preflight failing for every other origin is what actually
  // stops a malicious page from acting for a signed-in user — see src/auth/csrf.service.ts, where
  // the whole chain is written out. Reflecting the origin would hand that page a CSRF token
  // minted for the victim's session.
  app.enableCors({
    origin: config.frontendBaseUrl,
    credentials: true,
    // Spelled out rather than left to the default, which echoes whatever the preflight asked for.
    allowedHeaders: ['content-type', CSRF_HEADER],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // Without this, `Retry-After` is a response header the browser receives but JavaScript on
    // FRONTEND_BASE_URL cannot read (the CORS spec exposes only a small safelist by default, and
    // this is not on it) — RateLimitGuard computes a real number of seconds and it was landing on
    // the wire for nothing. Found in /code-review of #24/#25; belongs here rather than in that
    // ticket's own files because this is the one place CORS is configured (DECISIONS.md §74).
    exposedHeaders: [RETRY_AFTER_HEADER],
  });

  // M1: every path starts with /api/v1/. Set once, here.
  //
  // This is a prefix, not a versioning mechanism. Nest's VersioningType.URI would let
  // controllers declare their own versions and serve several at once; we deliberately do
  // not want that, because nothing in this project has agreed to support two versions of
  // anything. If a v2 is ever needed, that is a decision to take then.
  app.setGlobalPrefix('api/v1');

  // K3: class-validator at the controller boundary, for every route, with no opt-out.
  // Past this pipe, data is considered clean and genuinely typed.
  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties no DTO declared, so a client cannot smuggle extra fields into a
      // service that later trusts them.
      whitelist: true,
      // Reject rather than silently strip. Silently dropping a field the caller believed in
      // means a request that looks like it worked and did something else — the frontend sets
      // `quanity: 2`, gets 201, and the order has one item.
      forbidNonWhitelisted: true,
      // Query and path parameters arrive as strings; DTOs declare real types.
      //
      // `transformOptions.enableImplicitConversion` is deliberately *not* set. It sounds like
      // the right complement to `transform: true`, but it makes class-transformer's automatic
      // primitive coercion run for any property whose reflected type is a primitive — including
      // ones that already carry an explicit `@Transform` — and that automatic pass wins,
      // discarding whatever the custom `@Transform` computed and silently reverting to the
      // property's default value instead. `PaginationQueryDto.limit` is exactly such a property:
      // with this flag on, `?limit=50` was answered with the default page size (20) every time,
      // never the value the caller asked for. Every field here that needs string→typed
      // conversion already has its own explicit `@Transform` (see PaginationQueryDto and every
      // DTO that extends it) or is a UUID string that needs no conversion at all, so this flag
      // was buying nothing and quietly breaking the one thing it looked like it was helping.
      transform: true,
      // L4: validation failures come out in the project's error shape with per-field messages,
      // not Nest's default array of English sentences.
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // One filter for the whole application (L4). Registered here rather than as a module provider
  // so it also catches what happens before any module is reached — the 404 for an unmatched
  // route, which would otherwise come back in Nest's own shape.
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));

  app.enableShutdownHooks();
}

/**
 * Builds the OpenAPI document from the DTOs (M4).
 *
 * There is deliberately no hand-written docs/api.md: a second description of the same
 * contract is a second thing to forget to update. The DTOs are the description.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('VRU Marketplace API')
    .setDescription(
      'Community marketplace backend. Money never passes through this platform: buyers ' +
        'transfer directly to each shop, and the shop confirms receipt. See CLAUDE.md for the ' +
        'invariants and docs/DECISIONS.md for why they are what they are.',
    )
    .setVersion('1')
    .addCookieAuth('access_token', {
      type: 'apiKey',
      in: 'cookie',
      name: 'access_token',
      description:
        'Both tokens live in httpOnly cookies and are never returned in a response body (B3). ' +
        'Requests that change state also need the paired CSRF token.',
    })
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Everything that has to happen after the container is initialised.
 *
 * Swagger is mounted here rather than in `configureApp` because building the document means
 * scanning the routes, which only exist once the app has initialised — and the not-found handler
 * has to come after both.
 *
 * Exported for clarity rather than for direct use: call `initialiseApp`, which guarantees this
 * runs at the right point.
 *
 * Not mounted in production: the document describes every route and field of a system whose
 * admin surface is not public, and it is of no use to the people using the site. The
 * frontend team reads it from a development or staging deployment.
 */
export function finalizeApp(app: INestApplication): void {
  const config = app.get(AppConfig);

  if (!config.isProduction) {
    SwaggerModule.setup('api/v1/docs', app, buildOpenApiDocument(app));
  }

  // Must come after every route, including Swagger's, so it only runs when nothing matched.
  installNotFoundHandler(app);
}

/**
 * Answers an unmatched path in the project's error shape.
 *
 * Without this, Express's own final handler replies with an HTML page — `<!DOCTYPE html>` and
 * "Cannot GET /api/v1/nope". The global exception filter never sees it, because no Nest exception
 * was ever raised: nothing in Nest throws for a path the router did not match. A frontend with one
 * error handler would get HTML where it expected JSON, from the most ordinary mistake there is.
 *
 * It builds the body through `toErrorPayload` rather than writing a literal, so there is still
 * exactly one definition of what an error looks like (L4).
 */
function installNotFoundHandler(app: INestApplication): void {
  const { httpAdapter } = app.get(HttpAdapterHost);
  const express = httpAdapter.getInstance<Express>();

  express.use((_request: Request, response: Response) => {
    const payload = toErrorPayload(new AppException('NOT_FOUND'));
    httpAdapter.reply(response, payload.body, payload.status);
  });
}
