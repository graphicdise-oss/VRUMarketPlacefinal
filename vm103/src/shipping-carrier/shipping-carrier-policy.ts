/**
 * The numbers this module runs on, same reasoning as `category-policy.ts`: ordinary engineering
 * defaults, not a business rule anyone could get wrong. The name's own maximum matches the
 * schema's `@db.VarChar(100)`.
 */

export const MIN_CARRIER_NAME_LENGTH = 1;
export const MAX_CARRIER_NAME_LENGTH = 100;
