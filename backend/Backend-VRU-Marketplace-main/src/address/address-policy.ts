/**
 * The numbers and shapes this module runs on. Ordinary engineering defaults, not business rules
 * — matched to the schema's own `@db.VarChar` lengths (see prisma/schema.prisma's Address model).
 */

export const MAX_RECIPIENT_NAME_LENGTH = 100;

export const MAX_HOUSE_NUMBER_LENGTH = 50;
export const MAX_VILLAGE_NUMBER_LENGTH = 50;
export const MAX_ALLEY_LENGTH = 100;
export const MAX_ROAD_LENGTH = 100;

/**
 * A Thai phone number: a leading 0, then 8 or 9 more digits — 9 digits total for a landline
 * (0 + area code + number), 10 for a mobile. No `+66` international form and no separators: a
 * delivery form asks for a number a courier dials as printed, not a number formatted for display.
 */
export const PHONE_PATTERN = /^0\d{8,9}$/;

/**
 * §113 (owner's decision): how many live addresses one account may keep — the same ceiling Shopee
 * gives its users. Soft-deleted rows do not count; deleting one frees its place.
 */
export const MAX_ADDRESSES_PER_ACCOUNT = 10;
