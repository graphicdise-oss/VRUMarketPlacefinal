import { SetMetadata } from '@nestjs/common';

export const REFUSES_ADMINS = 'community:refusesAdmins';

/**
 * §85 (N29): marks a route that only an ordinary account may use — never a community admin, never
 * a super admin. The owner's rule: an account with admin power is kept visibly apart from ordinary
 * users, so it neither runs a shop nor buys anything, and so can never be a party to the orders,
 * disputes and reviews it may be asked to judge.
 *
 * The one gate, the same shape as `@RequiresVerifiedEmail()` — opt-in metadata read by one global
 * guard (`AdminAccountGuard`), never an `if` repeated inside each service. Carried by the three
 * routes that start a sale: applying to open a shop, adding to the cart, and checking out.
 */
export const RefusesAdmins = (): MethodDecorator & ClassDecorator => SetMetadata(REFUSES_ADMINS, true);
