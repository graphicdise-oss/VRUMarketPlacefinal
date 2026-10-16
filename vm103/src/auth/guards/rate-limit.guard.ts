import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppException } from '../../common/errors/app-exception.js';
import { RETRY_AFTER_HEADER } from '../../common/errors/retry-after.js';
import { readSession } from '../authenticated-request.js';
import { RATE_LIMIT_RULES } from '../decorators/rate-limit.decorator.js';
import { normaliseEmail } from '../email-address.js';
import { RateLimitName, RateLimitPolicy, RateLimitRule } from '../rate-limit.policy.js';
import { RateLimitService } from '../rate-limit.service.js';


/**
 * Enforces the ceilings a route asked for with `@RateLimited()`.
 *
 * Registered globally so the decorator works on any controller, but it does nothing at all to a
 * route that carries no metadata — see the decorator for why this one is opt-in where
 * authentication is opt-out.
 *
 * It runs **after** `CsrfGuard`, which matters: a request that fails the CSRF check never reaches
 * a handler, so letting it consume somebody's allowance would hand an attacker a way to lock an
 * account out with requests the system was going to refuse anyway.
 *
 * ⚠️ **Nothing here ever locks an account** (I17). Every ceiling is a window that reopens, and a
 * refused attempt does not extend it. The failure mode being avoided is specific and has been
 * shipped by many systems: "five wrong passwords and the account is locked" is a feature that
 * lets anybody lock anybody else out of their own account, for free, from anywhere.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: RateLimitPolicy,
    private readonly counters: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // #66: the decorator check runs before the transport check (the reverse of how this read
    // before ChatGateway existed) — the same order VerifiedEmailGuard/SuperAdminGuard already
    // use for their own opt-in decorators. Every chat event handler is undecorated, so this
    // returns `true` for it on the very next line, same as it would for an undecorated HTTP
    // route; a websocket handler that *does* opt in (#67's own AC needs one) is the case the
    // block below still refuses, since consuming an IP-keyed counter and reaching for a
    // `Response` to set `Retry-After` on are both HTTP-shaped operations this guard cannot do
    // over a socket — #67 has to answer that differently, not by this guard quietly passing.
    const names = this.reflector.getAllAndOverride<readonly RateLimitName[]>(RATE_LIMIT_RULES, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (names === undefined) {
      return true;
    }

    if (context.getType() !== 'http') {
      return false;
    }

    const request = context.switchToHttp().getRequest<Request>();

    for (const name of names) {
      const rule = this.policy.rule(name);
      const outcome = await this.counters.consume(keyFor(rule, request), rule.max, rule.windowMs);

      if (!outcome.allowed) {
        // RFC 9110 §10.2.3: a plain integer number of seconds until it is worth trying again.
        // Set on the response directly rather than carried on AppException, because the header is
        // an HTTP concept with nothing to mean over the websocket transport AppException also has
        // to serve — and this guard already refuses anything that is not HTTP, above.
        //
        // This does not reopen the oracle I16 spends the rest of this topic closing: the wait is
        // the same whichever rule fired, because the counter is keyed on what was *attempted*
        // (see keyFor), not on whether the address turns out to have an account. One code and one
        // message still cover every ceiling — a number of seconds says nothing about *which* rule
        // was hit or why.
        const response = context.switchToHttp().getResponse<Response>();
        response.setHeader(RETRY_AFTER_HEADER, String(outcome.retryAfterSeconds));

        throw new AppException('RATE_LIMITED');
      }
    }

    return true;
  }
}

/**
 * The counter this request belongs to.
 *
 * The rule's name is part of the key, so a route's ceilings never share a counter with another
 * route's — without it, registering would eat into the allowance for signing in.
 */
function keyFor(rule: RateLimitRule, request: Request): string {
  const source = request.ip ?? 'unknown';

  if (rule.keyKind === 'ip') {
    return `${rule.name}|${source}`;
  }

  if (rule.keyKind === 'account') {
    // AuthGuard runs first (auth.module.ts) and has attached the session by now. A route without
    // one cannot carry an 'account' rule meaningfully — counted by address rather than let through.
    const session = readSession(request);
    return session === null ? `${rule.name}|ip|${source}` : `${rule.name}|account|${session.user.id}`;
  }

  return `${rule.name}|${source}|${emailFromBody(request)}`;
}

/**
 * The address this request is about, as the counter sees it.
 *
 * A guard runs **before** the validation pipe, so what is read here is the parsed JSON body and
 * not a DTO — there is no validated `email` to reach for yet, and moving the limit behind the pipe
 * would mean a malformed body could be sent without limit. Hence the narrowing, and hence the
 * same `normaliseEmail` the DTOs apply: without it, `Foo@example.com` and `foo@example.com` would
 * be two counters for one account, and an attacker would get a fresh allowance per spelling.
 *
 * A request with no usable address still counts, under the empty string. Those requests are
 * rejected by the pipe a moment later, and the ones that reach here in volume are not honest
 * mistakes.
 */
function emailFromBody(request: Request): string {
  const body: unknown = request.body;

  if (typeof body !== 'object' || body === null) {
    return '';
  }

  const email: unknown = (body as Record<string, unknown>).email;

  return typeof email === 'string' ? normaliseEmail(email) : '';
}
