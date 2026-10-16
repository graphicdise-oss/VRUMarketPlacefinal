import { SetMetadata } from '@nestjs/common';

export const REQUIRES_VERIFIED_EMAIL = 'auth:requiresVerifiedEmail';

/**
 * Marks a route as needing a confirmed email address, not merely a signed-in caller.
 *
 * **This is the one gate. Nothing else may ask the question.** K4 decided that adding to the cart
 * and ordering both require a verified address, and B0.1 that browsing and searching do not — so
 * the rule lands on a handful of routes spread over topics 4 and 7. Written as an `if` inside each
 * of them it would be several rules that drift; written here it is one, and a reviewer can find
 * every route that carries it by searching for this decorator.
 *
 *   @Post('items')
 *   @RequiresVerifiedEmail()
 *   addToCart(...) { … }
 *
 * Opt-in, unlike authentication, because most of this site works without a verified address.
 * The guard behind it answers EMAIL_NOT_VERIFIED, which is a different code from UNAUTHENTICATED
 * on purpose: one means "sign in", the other means "go and read your email", and a frontend that
 * cannot tell them apart sends people to the wrong screen.
 *
 * `POST /shops` (#34, applying to open a shop) is the first route to carry it; topic 7's cart is
 * the second, per K4.
 */
export const RequiresVerifiedEmail = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_VERIFIED_EMAIL, true);
