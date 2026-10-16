/**
 * K4 doesn't specify a quantity ceiling — the cart never checks stock (#50 is what reserves it),
 * so there is nothing that would otherwise stop an arbitrarily large number here. An ordinary
 * engineering default, not a business rule.
 */
export const MAX_CART_ITEM_QUANTITY = 999;

/**
 * §111 (the owner's number): distinct lines in one cart. Checkout locks every variant in the cart
 * one by one inside one transaction, so an unbounded cart is an unbounded transaction.
 */
export const MAX_CART_LINES = 100;
