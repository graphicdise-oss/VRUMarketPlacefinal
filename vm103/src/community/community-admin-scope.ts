import type { Prisma, UserRole } from '@prisma/client';
import type { AuditEntry } from '../audit/audit-log.service.js';
import { AppException } from '../common/errors/app-exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * "Which communities may this caller review a queue for" — a plain function rather than a
 * service method, so any module with a pending-review list of its own (`Shop`'s in #35,
 * `Product`'s in #43, more later) can call it without importing `CommunityModule` for DI wiring
 * it has no other reason to need. Takes `prisma` as a parameter for the same reason
 * `LIVE_SHOP_FILTER`/`PRODUCT_OWN_VISIBILITY_FILTER` are plain exported constants: a pure
 * computation should not force a cross-module provider dependency.
 *
 * `'all'` for a super admin (invariant 1: passes every gate a community admin passes without a
 * `CommunityAdmin` row), the caller's own community ids otherwise, or `'none'` for a caller who
 * administers nothing — answered as an empty page by the caller, not `FORBIDDEN`: an ordinary
 * signed-in user asking "what do I have to review" has a truthful answer of zero, not a
 * permission error. The actual approve/reject routes are what enforce `FORBIDDEN`, via
 * `CommunityScopeGuard`.
 *
 * Extracted from `ShopService.communityFilterFor` (#35) when #43 needed the identical logic for
 * a product review queue — the same "shared things go to their first *second* caller" reasoning
 * N1 already gives for `ShopService.findOwnShopRow`.
 */
export async function communityFilterFor(
  prisma: PrismaService,
  actorUserId: string,
  role: UserRole,
): Promise<'all' | 'none' | string[]> {
  if (role === 'SUPER_ADMIN') {
    return 'all';
  }

  const rows = await prisma.communityAdmin.findMany({
    where: { userId: actorUserId },
    select: { communityId: true },
  });

  return rows.length === 0 ? 'none' : rows.map((row) => row.communityId);
}

/**
 * The communities an admin view covers: every one (a super admin), or these. A `communityFilterFor`
 * result once its `'none'` case is handled — §127 names it, since every queue condition takes one.
 */
export type CommunityScope = 'all' | string[];

/**
 * §115: the `where` fragment for a `communityFilterFor` result already past its `'none'` check —
 * every admin queue (shops, profile changes, products, frozen orders, disputes) filters with it, so
 * "all" and "these communities" are spelled once.
 */
export function inCommunities(filter: CommunityScope): { communityId?: { in: string[] } } {
  return filter === 'all' ? {} : { communityId: { in: filter } };
}

/**
 * Invariant 1's community wall, defined once: a super admin passes every community; anyone else
 * only one they hold a `CommunityAdmin` row for. `CommunityScopeGuard` asks it for HTTP routes, and
 * the admin↔shop chat (§106) asks it for socket events, which no guard ever sees.
 */
export async function isAdminOfCommunity(
  prisma: Pick<PrismaService, 'communityAdmin'>,
  user: { readonly id: string; readonly role: UserRole },
  communityId: string,
): Promise<boolean> {
  if (user.role === 'SUPER_ADMIN') {
    return true;
  }
  const membership = await prisma.communityAdmin.findUnique({
    where: { userId_communityId: { userId: user.id, communityId } },
    select: { id: true },
  });

  return membership !== null;
}

/**
 * §85 (N29): whether this account holds any admin power at all — super admin, or a
 * `CommunityAdmin` row in any community. The single definition `AdminAccountGuard` uses to keep
 * admin accounts from buying or running a shop.
 */
export async function isAnyAdmin(prisma: Pick<PrismaService, 'communityAdmin'>, userId: string, role: UserRole): Promise<boolean> {
  if (role === 'SUPER_ADMIN') {
    return true;
  }

  const row = await prisma.communityAdmin.findFirst({ where: { userId }, select: { id: true } });

  return row !== null;
}

/**
 * N28, extended by §85 to every ruling an admin makes about an order: the caller may not judge a
 * case they are a party to — as the shop's owner, or as the order's buyer (or, for a review, its
 * author). §85's N29 already stops an admin from buying or opening a shop *from now on*, but a
 * person who was made admin after closing their shop, or after placing an order, still has those
 * old orders; this is the check that covers them. Super admin included, the same as N28.
 */
export function refuseOwnCase(actorUserId: string, parties: CaseParties): void {
  if (isPartyTo(actorUserId, parties)) {
    throw new AppException('FORBIDDEN', { message: 'คุณตัดสินเรื่องที่ตัวเองเป็นคู่กรณีไม่ได้ ให้แอดมินคนอื่นเป็นผู้ตัดสิน' });
  }
}

/**
 * §102: the same line for an admin's *reads* of a case — break-glass, slips, evidence, the dispute
 * record and the chat room. A party already has their own view of their own order; what the admin
 * door adds is what a neutral admin is trusted with and a party is not — the other side's PII, and
 * the chat messages the other side unsent (§89 keeps those for a neutral admin only).
 */
export function refuseOwnCaseAccess(actorUserId: string, parties: CaseParties): void {
  if (isPartyTo(actorUserId, parties)) {
    throw new AppException('FORBIDDEN', { message: 'เรื่องนี้คุณเป็นคู่กรณี จึงเปิดดูผ่านช่องทางของแอดมินไม่ได้ ให้แอดมินคนอื่นดูแลแทน' });
  }
}

export interface CaseParties {
  readonly buyerId: string;
  readonly shopOwnerId: string;
}

function isPartyTo(actorUserId: string, parties: CaseParties): boolean {
  return actorUserId === parties.buyerId || actorUserId === parties.shopOwnerId;
}

/**
 * §102: the community admins who should hear about a case waiting in their queue — everyone with a
 * `CommunityAdmin` row for this community, except the case's own parties (they cannot rule on it).
 * Super admins are not listed: they see every community's queue and are not paged for each one.
 * §112: nor is an admin whose account is banned or erased.
 */
export async function communityAdminsToNotify(
  client: Pick<PrismaService, 'communityAdmin'>,
  communityId: string,
  parties: CaseParties,
): Promise<string[]> {
  // §112: not a banned or erased admin — neither can sign in to act, and paging them hid that the
  // community's queue reached nobody.
  const rows = await client.communityAdmin.findMany({
    where: { communityId, user: { bannedAt: null, erasedAt: null } },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });

  return rows.map((row) => row.userId).filter((userId) => !isPartyTo(userId, parties));
}

/**
 * The audit entry for granting or taking away admin rights — shared by `CommunityAdminService` and,
 * since §112, by erasure, which revokes every admin row of the account it erases.
 *
 * Targets the **user**, not the `community_admin` row. The row is deleted by `revoke`, so an
 * entry pointing at its id becomes unresolvable the moment it matters most — and both entries
 * of a grant-then-revoke pair would be orphans, leaving #33's reader with two target ids that
 * resolve to nothing. A user id outlives everything: PDPA erasure anonymises `User` rather
 * than deleting it (invariant 5), the same reason `AuditLog.actorUserId` is safe to store.
 * `USER_BANNED` already targets the person for exactly this reason.
 *
 * `communityId` closes the gap N22 deferred to #33: which community this grant or revoke was
 * about, carried in its own column rather than squeezed into the single target slot above.
 *
 * `actorUserId` is null when the system itself is acting — §125: the first super admin's promotion
 * folds in their community rows with no person behind it.
 */
export function communityAdminGrantEntry(
  actorUserId: string | null,
  action: 'COMMUNITY_ADMIN_ASSIGNED' | 'COMMUNITY_ADMIN_REVOKED',
  targetUserId: string,
  communityId: string,
): AuditEntry {
  return { actorUserId, action, targetType: 'COMMUNITY_ADMIN', targetId: targetUserId, communityId };
}

/**
 * §112: the community row, FOR SHARE, inside a transaction that is about to hang a row off it (a shop,
 * an admin). `CommunityService.remove` takes it FOR UPDATE, so a delete racing the insert either
 * commits first — answered here as the plain 404 the caller's own pre-check gives — or waits and then
 * counts the new row and refuses. Without it the insert met the delete as a foreign-key 500.
 */
export async function requireCommunityForShare(tx: Prisma.TransactionClient, communityId: string): Promise<void> {
  const [community] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM community WHERE id = ${communityId}::uuid FOR SHARE`;
  if (community === undefined) {
    throw new AppException('NOT_FOUND', { message: 'ไม่พบชุมชนนี้' });
  }
}

/** §85 (N29): the one wording for "admin accounts never buy or run a shop" — the guard's and the re-check under lock (§112). */
export const ADMIN_ACCOUNT_REFUSED = 'บัญชีแอดมินเปิดร้านหรือสั่งซื้อสินค้าไม่ได้ กรุณาใช้บัญชีผู้ใช้ทั่วไปแยกต่างหาก';

/**
 * §85 (N29): whether this account still runs an open shop — the one thing that keeps a person from
 * being made an admin of any kind. Only a shop not closed counts (a rejected application is closed
 * too, #35). Shared by appointing a community admin (§112) and a super admin (§125), before their
 * transaction and again under the person's row lock, so the two can never disagree.
 */
export async function ownsOpenShop(db: Pick<Prisma.TransactionClient, 'shop'>, userId: string): Promise<boolean> {
  return (await db.shop.count({ where: { ownerId: userId, closedAt: null } })) > 0;
}

/**
 * §125 · §126: a super admin's right, read again inside the transaction that grants or takes away
 * admin rights — under their row, which the caller has locked (`lockAccountRowsInIdOrder`) — not
 * only by the guard at the start of the request. A super admin cannot be banned through the system
 * (N13), so what this catches is their own erasure, or their role changed in the database, landing
 * mid-request. Throws 403, the same code the guard gives a non-super-admin: the answer is the same.
 */
export async function requireActingSuperAdmin(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const row = await tx.user.findUnique({ where: { id: userId }, select: { role: true, bannedAt: true, erasedAt: true } });
  if (row === null || row.role !== 'SUPER_ADMIN' || row.bannedAt !== null || row.erasedAt !== null) {
    throw new AppException('FORBIDDEN', { message: 'สิทธิ์ผู้ดูแลระบบสูงสุดของคุณเปลี่ยนไประหว่างทาง จึงทำรายการนี้ไม่ได้' });
  }
}
