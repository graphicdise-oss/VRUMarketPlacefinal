/**
 * The numbers this module runs on, in one place — same reasoning as auth-policy.ts.
 *
 * None of these come from a DECISIONS.md entry: nothing asked for a specific length, and a create
 * endpoint cannot exist without validation bounds. They are ordinary engineering defaults, not a
 * business rule anyone could get wrong — unlike a password minimum or a rate-limit ceiling, no
 * later ticket depends on the exact number, so this did not need to stop and ask.
 */

/** Long enough for any community's real name, short enough that a list screen still reads well. */
export const MIN_COMMUNITY_NAME_LENGTH = 2;
export const MAX_COMMUNITY_NAME_LENGTH = 200;

/** A paragraph or two of what a visitor sees on the community's page. */
export const MIN_COMMUNITY_DESCRIPTION_LENGTH = 1;
export const MAX_COMMUNITY_DESCRIPTION_LENGTH = 2000;
