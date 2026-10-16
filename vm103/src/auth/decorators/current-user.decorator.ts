import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { CurrentUser as CurrentUserType, readSession } from '../authenticated-request.js';

/**
 * The signed-in caller, as resolved from the database by `AuthGuard` on this request.
 *
 *   @Get('me')
 *   me(@CurrentUser() user: CurrentUser): MeDto { … }
 *
 * It throws rather than returning undefined when there is no session. On a protected route that
 * cannot happen — the guard already refused — so reaching this means the route is `@Public()` and
 * the author assumed otherwise. An undefined here would travel into the handler and surface as a
 * confusing 500 from `user.id`, or worse, as a query for `undefined` that quietly matches nothing.
 *
 * A public route that wants to know *whether* someone is signed in uses `readSession(request)`
 * directly and handles null, because that is a decision the handler has to make out loud.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserType => {
    const session = readSession(context.switchToHttp().getRequest<object>());

    if (session === null) {
      throw new Error(
        '@CurrentUser() was used on a route with no authenticated session. Either remove ' +
          '@Public() from it, or read the session with readSession() and handle the anonymous ' +
          'case explicitly.',
      );
    }

    return session.user;
  },
);
