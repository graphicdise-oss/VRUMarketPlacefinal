/**
 * The numbers this module runs on, same reasoning as community-policy.ts: ordinary engineering
 * defaults, not a business rule anyone could get wrong. The name's own maximum matches the
 * schema's `@db.VarChar(100)` — a category name is a short label, not a description.
 */

export const MIN_CATEGORY_NAME_LENGTH = 1;
export const MAX_CATEGORY_NAME_LENGTH = 100;
