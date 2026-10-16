/**
 * The numbers `Shop`'s own profile fields run on (#73). Matched to `Product`'s own
 * `product-policy.ts` constants — a shop's display name and bio are the same shape of free text
 * as a product's, with no reason to pick different ceilings.
 */

export const MAX_SHOP_NAME_LENGTH = 200;
export const MAX_SHOP_DESCRIPTION_LENGTH = 5000;
