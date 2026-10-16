/**
 * The closed vocabulary of things worth recording.
 *
 * CLAUDE.md invariant 1: every admin action must reach `audit_log`. That only means something
 * if the recorded action names are consistent — a log where the same event is sometimes
 * `SHOP_SUSPENDED` and sometimes `suspend_shop` cannot be filtered, counted, or trusted.
 *
 * These are TypeScript unions over a `String` column rather than a Prisma enum. A DB enum
 * would need an `ALTER TYPE` migration from every later topic that records something new,
 * which couples eleven topics to one another's migrations for no integrity we do not already
 * get: the compiler rejects any name not listed here, so there is no path by which a typo
 * reaches the database. That is the same failure the triage-label note in CLAUDE.md warns
 * about — a misspelling that silently becomes a new category instead of an error.
 *
 * Adding an action is a deliberate edit to this file. That is the intended friction.
 */

export const AUDIT_ACTIONS = [
  // Topic 3 — communities and admin rights
  'COMMUNITY_CREATED',
  'COMMUNITY_UPDATED',
  // §112: a community that never had a shop or an admin, removed by a super admin.
  'COMMUNITY_DELETED',
  'COMMUNITY_ADMIN_ASSIGNED',
  // §124 (K2): the platform's first super admin, set up by the system from SUPER_ADMIN_EMAIL.
  'SUPER_ADMIN_BOOTSTRAPPED',
  // §125: a super admin appointing another (actor = the appointer).
  'SUPER_ADMIN_APPOINTED',
  'COMMUNITY_ADMIN_REVOKED',
  'SUPER_ADMIN_GRANTED',
  'SUPER_ADMIN_REVOKED',
  'AUDIT_LOG_VIEWED',

  // Topic 4 — shops
  'SHOP_APPROVED',
  'SHOP_REJECTED',
  'SHOP_CLOSED',
  'SHOP_SUSPENDED',
  'SHOP_UNSUSPENDED',
  // §86: a community admin deciding a waiting name/description/logo change on an approved shop.
  'SHOP_PROFILE_APPROVED',
  'SHOP_PROFILE_REJECTED',

  // Topic 5 — categories and products
  'CATEGORY_CREATED',
  'CATEGORY_UPDATED',
  'PRODUCT_APPROVED',
  'PRODUCT_REJECTED',

  // Topic 9 — shipping carriers (L5, same super-admin-owned shape as categories)
  'SHIPPING_CARRIER_CREATED',
  'SHIPPING_CARRIER_UPDATED',

  // Topic 2 / 12 — accounts
  'USER_BANNED',
  'USER_UNBANNED',
  'ACCOUNT_ERASED',
  // §86: an admin asking for someone else's erasure — irreversible, so it is logged the moment it
  // is asked (the erasure itself may wait out the grace period before `ACCOUNT_ERASED` lands).
  'ACCOUNT_ERASURE_REQUESTED',
  // §87: an unban withdrawing the erasure an admin queued on the strength of the ban.
  'ACCOUNT_ERASURE_CANCELLED',
  // §101: an account nobody ever proved (unverified) closed because Google's proven owner of its
  // address signed in — not anybody's own PDPA request, so not `ACCOUNT_ERASED`.
  'UNPROVEN_ACCOUNT_RETIRED',

  // Topic 9 — reviews (L3)
  'REVIEW_DELETED',

  // Topic 10 — frozen orders and disputes
  'ORDER_FROZEN',
  'ORDER_UNFROZEN',
  'FROZEN_ORDER_RULED',
  'DISPUTE_RULED',
  'DISPUTE_RULING_OVERRIDDEN',
  'DISPUTE_CHAT_VIEWED',
  // §106: an admin writing in a shop's admin chat — every send, edit and unsend (the owner's choice).
  'SHOP_ADMIN_CHAT_MESSAGE_SENT',
  'SHOP_ADMIN_CHAT_MESSAGE_EDITED',
  'SHOP_ADMIN_CHAT_MESSAGE_UNSENT',
  'DISPUTE_IDENTITY_REVEALED',
  // §85: an admin opening a piece of dispute evidence — it can carry a parcel label or a face, and
  // invariant 1 has every admin action reach this log, the same as a chat view (invariant 8).
  'DISPUTE_EVIDENCE_VIEWED',
  // §103 (owner's decision): an admin opening one dispute (§102's admin view) — it carries the
  // reason and answer the parties typed themselves, which can hold a name or a phone number. The
  // queue listing is not audited, the same as the shop and product review queues.
  'DISPUTE_VIEWED',
  // Broadcast Notifications
  'BROADCAST_NOTIFICATION_SENT',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * What the action was done to. Paired with an id, this answers "กับอะไร".
 *
 * `SYSTEM` is for actions with no single target — an admin reading the audit log itself, for
 * instance. It carries a null target id rather than a fabricated one.
 */
export const AUDIT_TARGET_TYPES = [
  'COMMUNITY',
  'COMMUNITY_ADMIN',
  'SHOP',
  'CATEGORY',
  'SHIPPING_CARRIER',
  'PRODUCT',
  'USER',
  'ORDER',
  'DISPUTE',
  'REVIEW',
  'CHAT_ROOM',
  'SYSTEM',
] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/**
 * Actions the project has decided must carry a written reason.
 *
 * Two decisions put entries here. K12: a dispute ruling's reason is shown to both the buyer
 * and the shop, so a ruling with no reason is not a valid ruling. L3: a community admin
 * deleting a review must say why. The rest follow the same logic — anything that takes
 * something away from someone needs to be answerable later.
 *
 * The writer enforces this rather than the database, because "required for these actions but
 * not those" is not a constraint a nullable column can express. Making the column NOT NULL
 * instead would force an empty string onto every action that has nothing to explain, and an
 * empty string is how a required field becomes decorative.
 */
export const ACTIONS_REQUIRING_REASON: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'SHOP_REJECTED',
  'SHOP_SUSPENDED',
  'SHOP_PROFILE_REJECTED',
  'PRODUCT_REJECTED',
  'USER_BANNED',
  'ACCOUNT_ERASURE_REQUESTED',
  'REVIEW_DELETED',
  'FROZEN_ORDER_RULED',
  'DISPUTE_RULED',
  'DISPUTE_RULING_OVERRIDDEN',
  'DISPUTE_IDENTITY_REVEALED',
]);

export function requiresReason(action: AuditAction): boolean {
  return ACTIONS_REQUIRING_REASON.has(action);
}
