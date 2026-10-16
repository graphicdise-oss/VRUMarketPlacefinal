/**
 * The closed vocabulary of things worth notifying a user about (#69), grouped by the topic whose
 * event fires them.
 *
 * A TypeScript union over a `String` column, the same shape and the same reason `AuditAction`
 * uses (see that file's own comment): later topics add a type without an `ALTER TYPE` migration,
 * and the union already stops a typo at compile time.
 */
export const NOTIFICATION_TYPES = [
  // Topic 7/8 — order clocks, shipping fee, payment
  'ORDER_SHIPPING_FEE_SET',
  'ORDER_DEADLINE_WARNING_SHIPPING_QUOTE',
  'ORDER_DEADLINE_WARNING_PAYMENT',
  'ORDER_DEADLINE_WARNING_PAYMENT_CONFIRMATION',
  'ORDER_CANCELLED_TIMEOUT',
  'ORDER_SLIP_REJECTED',
  'ORDER_PAYMENT_CONFIRMED',
  'ORDER_SHIPPED',
  'ORDER_RECEIVED',
  'ORDER_REFUND_ORDERED_AUTO',
  'ORDER_STOCK_ADJUST_NEEDED',
  'ORDER_FROZEN',
  'ORDER_UNFROZEN',
  // §85: the shop was the one party these three events never told — a buyer walking away from a
  // quote or an order, and an admin ending a frozen order (which may leave the shop owing a refund).
  'ORDER_CANCELLED_BY_BUYER',
  'ORDER_SHIPPING_FEE_REJECTED',
  'ORDER_TERMINATED',
  // §87: an unpaid order cancelled because a product in it was ruled PROHIBITED (H4).
  'ORDER_CANCELLED_PROHIBITED',

  // Topic 10 — disputes and the refund loop
  // §85: the shop is the side that has to answer a dispute, and nothing used to tell it one exists.
  'DISPUTE_OPENED',
  'DISPUTE_RULED',
  'REFUND_SLIP_UPLOADED',
  // §102: the community admins are the side that has to rule, and nothing used to tell them —
  // a new dispute, and an order that froze, each wait in a queue until someone decides.
  'DISPUTE_AWAITING_RULING',
  'ORDER_FROZEN_AWAITING_RULING',

  // Topic 5 — product moderation
  'PRODUCT_APPROVED',
  'PRODUCT_REJECTED',

  // Topic 4 — shop approval and suspension
  'SHOP_APPROVED',
  // Added by topic 4's code review (2026-09-22): rejection was the one moderation outcome in the
  // system that told nobody. `PRODUCT_REJECTED` above already notifies, and the rejected shop
  // applicant is the party who has to act on it (read the reason, fix it, apply again) — leaving
  // them to discover it by polling GET /shops/me was an oversight, not a decision (§77).
  'SHOP_REJECTED',
  'SHOP_SUSPENDED',
  'SHOP_UNSUSPENDED',
  // §86: the outcome of a profile change that waited for review on an approved shop.
  'SHOP_PROFILE_APPROVED',
  'SHOP_PROFILE_REJECTED',
  // §105: a payment channel added, edited, given a new QR or removed — told to the owner so a
  // hijacked account's swap of where buyers pay does not go unnoticed. In-app only (the owner's choice).
  'PAYMENT_CHANNEL_CHANGED',

  // Topic 3 — communities and admin rights
  // §112: to the person a super admin made (or stopped being) an admin of a community. In-app only.
  'COMMUNITY_ADMIN_ASSIGNED',
  'COMMUNITY_ADMIN_REVOKED',
  // §125: to an existing account a super admin made a super admin. In-app only (the owner's choice).
  'SUPER_ADMIN_APPOINTED',

  // Topic 9 — reviews
  // §111: to the review's author when a community admin removes it (L3), with the admin's reason.
  // In-app only (the owner's choice).
  'REVIEW_REMOVED',

  // Topic 11 — chat
  'CHAT_MESSAGE',
  // §106: the admin↔shop chat — to the shop's owner when an admin writes, and to every admin of the
  // shop's community when the shop does. One unread notice per room, like CHAT_MESSAGE (§84).
  'SHOP_ADMIN_CHAT_FROM_ADMIN',
  'SHOP_ADMIN_CHAT_FROM_SHOP',

  // Topic 12 — PDPA erasure. Email only since §113: the account it is about is erased by then, and
  // `notify` writes no in-app row for an erased account.
  'ACCOUNT_ERASURE_COMPLETED',

  // Broadcast Notifications
  'PLATFORM_ANNOUNCEMENT',

  // Coupon notifications
  'COUPON_EXPIRING_WARNING',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** What a notification is about, paired with an id — mirrors `AuditTargetType`. */
export const NOTIFICATION_TARGET_TYPES = ['ORDER', 'DISPUTE', 'PRODUCT', 'SHOP', 'CHAT_ROOM', 'COMMUNITY', 'COUPON'] as const;

export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];

/**
 * I17: the only types this system ever emails for — a clock about to expire, a dispute outcome,
 * or money starting to move automatically. Every other type is in-app only, which is what makes
 * #69's own AC true ("เปลี่ยนสถานะธรรมดา → ไม่มีอีเมลออกไปเลย"): `NotificationService.notify`
 * throws if a caller passes an email for a type not in this set, or omits one for a type that is
 * — the same "the writer enforces it, not a nullable column" shape `ACTIONS_REQUIRING_REASON`
 * already establishes for `AuditLogService`.
 */
export const NOTIFICATION_TYPES_WITH_EMAIL: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'ORDER_DEADLINE_WARNING_SHIPPING_QUOTE',
  'ORDER_DEADLINE_WARNING_PAYMENT',
  'ORDER_DEADLINE_WARNING_PAYMENT_CONFIRMATION',
  'ORDER_REFUND_ORDERED_AUTO',
  'DISPUTE_RULED',
  'REFUND_SLIP_UPLOADED',
  // #71: the one notification that outlives the address it would normally be looked up by — see
  // `NotificationEmail.recipientEmail`'s own comment.
  'ACCOUNT_ERASURE_COMPLETED',
]);
