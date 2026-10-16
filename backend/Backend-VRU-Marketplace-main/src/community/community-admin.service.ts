import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { lockAccountRow } from '../common/live-account-lock.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { NotificationService } from '../notification/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { CommunityAdminRevocations } from './community-admin-revocations.js';
import { communityAdminGrantEntry, requireCommunityForShare } from './community-admin-scope.js';
import { CommunityAdminEntryDto } from './dto/community-admin-entry.dto.js';
import { CommunityAdminDto } from './dto/community-admin.dto.js';

const LIST_NAME = 'communityAdmins';

/** §85 (N29): the same answer before the transaction and under its lock (§112). */
const HAS_OPEN_SHOP = 'ผู้ใช้นี้ยังมีร้านที่เปิดอยู่ ต้องปิดร้านก่อนจึงจะแต่งตั้งเป็นแอดมินได้';

/** Both the pre-check and the unique-constraint backstop answer with these exact words. */
const ALREADY_ADMIN = 'คนนี้เป็นแอดมินของชุมชนนี้อยู่แล้ว';
const NOT_AN_ADMIN = 'คนนี้ไม่ได้เป็นแอดมินของชุมชนนี้';

/**
 * Who administers a community: `super admin` only, both ways.
 *
 * Everything here is a platform-role decision, not a community-scoped one — enforced by
 * `@RequiresSuperAdmin()` on the controller, not re-checked here, the same split
 * `CommunityService` uses. The two-tier guard that reads what this writes is #32; this ticket
 * only has to make the rows exist and disappear correctly, and log both.
 */
@Injectable()
export class CommunityAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
    private readonly revocations: CommunityAdminRevocations,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * §112 (the owner's decision): who administers this community — the list #31 left out, without
   * which a super admin could appoint and revoke but never see the current set. Newest appointment
   * first. A banned admin stays listed with `bannedAt` (N21), so the gap in who is paged is visible.
   */
  async list(communityId: string, limit: number, cursor: string | undefined): Promise<Page<CommunityAdminEntryDto>> {
    const community = await this.prisma.community.findUnique({ where: { id: communityId }, select: { id: true } });
    if (community === null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบชุมชนนี้' });
    }

    const rows = await this.prisma.communityAdmin.findMany({
      where: { communityId, ...keysetAfter(cursor, LIST_NAME) },
      orderBy: newestFirst(),
      take: limit + 1,
      select: { id: true, userId: true, assignedAt: true, assignedBy: true, user: { select: { email: true, bannedAt: true } } },
    });
    const page = toPage(rows, limit, LIST_NAME);

    return { ...page, items: page.items.map((row) => CommunityAdminEntryDto.from(row)) };
  }

  /**
   * Makes `targetUserId` an admin of `communityId`.
   *
   * Deliberately does not check the target's `bannedAt` or `emailVerifiedAt` (see the ticket
   * report / DECISIONS.md N21): a banned account is refused by the global `AuthGuard` before it
   * ever reaches the two-tier guard this row feeds, regardless of what rows it holds here, and no
   * admin route requires a verified email. Blocking the assignment here would just be a second,
   * redundant place that decision could go stale.
   */
  async assign(
    actorUserId: string,
    communityId: string,
    targetUserId: string,
  ): Promise<CommunityAdminDto> {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { id: true, name: true },
    });
    if (community === null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบชุมชนนี้' });
    }

    // Only the columns this decides on. A `findUnique` with no `select` hands the password hash to
    // a code path that has no use for it, which is the kind of thing that ends up in a log line
    // someone added later. §112: an erased account is nobody to appoint; a super admin already
    // passes every community, so a row for one would only mislead the admin list.
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, erasedAt: true },
    });
    if (user === null || user.erasedAt !== null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบผู้ใช้นี้' });
    }
    if (user.role === 'SUPER_ADMIN') {
      throw new AppException('CONFLICT', { message: 'ผู้ดูแลระบบสูงสุดดูแลทุกชุมชนอยู่แล้ว ไม่ต้องแต่งตั้ง' });
    }

    // §85 (N29): an admin never runs a shop — the other half of `@RefusesAdmins()` on applying.
    // Only a shop that is still open blocks (a rejected application is closed too, #35); the
    // person closes it first, and whatever orders it left behind stay theirs to finish as its
    // owner, with the N28 checks on every ruling keeping them from judging their own case.
    const openShop = await this.prisma.shop.findFirst({ where: { ownerId: targetUserId, closedAt: null }, select: { id: true } });
    if (openShop !== null) {
      throw new AppException('CONFLICT', { message: HAS_OPEN_SHOP });
    }

    const existing = await this.prisma.communityAdmin.findUnique({
      where: { userId_communityId: { userId: targetUserId, communityId } },
      select: { id: true },
    });

    if (existing !== null) {
      // Same call as AdminUsersService.ban() on an already-banned account: answering CONFLICT
      // rather than quietly succeeding means two admins assigning the same person at once do not
      // both believe *they* were the one who granted it, and `assignedBy` on the existing row
      // stays the true answer to "who did this" instead of being silently overwritten.
      throw new AppException('CONFLICT', { message: ALREADY_ADMIN });
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // §112: the person's row first (`user` heads the lock order, §91), and the open-shop check
        // again under it. `ShopService.apply` takes the same row and re-checks for admin rights
        // under it, so an appointment and an application racing each other can no longer both land.
        // Erasure takes the same row FOR UPDATE, so "not erased" is read again here too. Then the
        // community, FOR SHARE: a delete racing this either commits first (answered 404 here, not a
        // foreign-key 500 on the insert) or waits for this appointment and then refuses (§112, M7).
        const locked = await lockAccountRow(tx, targetUserId);
        if (locked === null || locked.erased) {
          throw new AppException('NOT_FOUND', { message: 'ไม่พบผู้ใช้นี้' });
        }
        await requireCommunityForShare(tx, communityId);
        if ((await tx.shop.count({ where: { ownerId: targetUserId, closedAt: null } })) > 0) {
          throw new AppException('CONFLICT', { message: HAS_OPEN_SHOP });
        }
        const row = await tx.communityAdmin.create({
          data: {
            id: newId(),
            userId: targetUserId,
            communityId,
            assignedBy: actorUserId,
            assignedAt: this.clock.now(),
          },
        });

        await this.audit.record(communityAdminGrantEntry(actorUserId, 'COMMUNITY_ADMIN_ASSIGNED', targetUserId, communityId), tx);
        // §112 (the owner's decision): the appointee used to find out only by noticing new screens.
        await this.notifications.record(
          { userId: targetUserId, type: 'COMMUNITY_ADMIN_ASSIGNED', message: `คุณได้รับแต่งตั้งเป็นแอดมินของ${community.name}`, targetType: 'COMMUNITY', targetId: communityId },
          tx,
        );

        return row;
      });

      return CommunityAdminDto.from(created);
    } catch (error) {
      // The check above loses the race when two assigns for the same pair arrive together; the
      // `@@unique` constraint catches it. Without this the loser gets a 500 for something the
      // caller is entitled to a plain 409 about, and the constraint the schema calls a backstop
      // would only ever have produced an unhandled error.
      if (isUniqueViolation(error)) {
        throw new AppException('CONFLICT', { message: ALREADY_ADMIN });
      }
      throw error;
    }
  }

  /**
   * Removes `targetUserId`'s admin rights over `communityId`.
   *
   * Effective on the target's very next request with no extra work here — the same reasoning as
   * `AdminUsersService.ban()`: nothing that reads this table caches the answer, so deleting the
   * row is the whole story (invariant 7).
   */
  async revoke(actorUserId: string, communityId: string, targetUserId: string): Promise<void> {
    const existing = await this.prisma.communityAdmin.findUnique({
      where: { userId_communityId: { userId: targetUserId, communityId } },
      select: { id: true },
    });

    if (existing === null) {
      throw new AppException('CONFLICT', { message: NOT_AN_ADMIN });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // §112: the person's row first, as `assign` and erasure take it (§91: `user` heads the order).
        // The notice written below holds a key lock on that row; taken after the admin row instead,
        // it deadlocked with an erasure deleting the same admin row under its own `user` lock.
        await lockAccountRow(tx, targetUserId);
        await tx.communityAdmin.delete({
          where: { userId_communityId: { userId: targetUserId, communityId } },
        });

        await this.audit.record(communityAdminGrantEntry(actorUserId, 'COMMUNITY_ADMIN_REVOKED', targetUserId, communityId), tx);
        const community = await tx.community.findUniqueOrThrow({ where: { id: communityId }, select: { name: true } });
        await this.notifications.record(
          { userId: targetUserId, type: 'COMMUNITY_ADMIN_REVOKED', message: `คุณไม่ได้เป็นแอดมินของ${community.name}แล้ว`, targetType: 'COMMUNITY', targetId: communityId },
          tx,
        );
      });
    } catch (error) {
      // Same race as assign, mirrored: two revokes for one pair, and the second finds the row
      // already gone. "Not an admin of this community" is the truth either way.
      if (isMissingRow(error)) {
        throw new AppException('CONFLICT', { message: NOT_AN_ADMIN });
      }
      throw error;
    }

    // §106: and out of the admin↔shop chat rooms of this community that their open sockets joined.
    await this.revocations.notify(targetUserId, communityId);
  }

}

/**
 * Whether Prisma is reporting a unique-constraint violation (P2002).
 *
 * Matched on the code, not the message — the message names the constraint and the column.
 * `AuthService` and `GoogleAuthService` each carry their own copy of this; three copies is one
 * too many, but consolidating them is not this ticket's diff to widen.
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Whether Prisma is reporting "the row this operation needed is not there" (P2025). */
function isMissingRow(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
