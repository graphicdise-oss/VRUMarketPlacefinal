import { Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service.js';
import { SessionService } from '../auth/session.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { lockAccountRow } from '../common/live-account-lock.js';
import { OrderFreezeService } from '../order/services/order-freeze.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { UserLookupDto } from './dto/user-lookup.dto.js';

/**
 * What a super admin can do to an account.
 *
 * Two operations, and the interesting half of both is what happens besides the column write:
 * every session ends, and `audit_log` gets a row. This is the first thing in the project that
 * writes an audit entry — #15 built the table and the writer with nothing calling them.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
    private readonly orderFreeze: OrderFreezeService,
  ) {}

  /**
   * Bans an account and signs it out everywhere.
   *
   * Invariant 7 is satisfied twice over, deliberately. The guard refuses a banned account on its
   * next request, which is what makes the ban immediate; revoking the sessions here is what makes
   * it true even for the refresh endpoint, and what means the rows do not sit around as live
   * credentials waiting for the guard to be the only thing in the way.
   *
   * The ban is a flag on the account and nothing more, plus — as of #61 — freezing whatever this
   * person has in flight: every non-terminal order where they're the buyer (I10), and every
   * non-terminal order any shop they own is selling (H2 — §92: every shop row, closed ones too). Both
   * go through `OrderFreezeService.freezeOrdersForAccount`, the one mechanism I10 requires for
   * banning a seller, suspending a shop and banning a buyer alike — in one id-ordered pass (§95).
   */
  async ban(actorUserId: string, targetUserId: string, reason: string): Promise<void> {
    const target = await this.requireTarget(targetUserId);

    if (target.id === actorUserId) {
      // A super admin who bans themselves cannot sign in to undo it, and if they are the only one
      // (K2 creates exactly one), the platform has no super admin at all from that moment.
      throw new AppException('FORBIDDEN', {
        message: 'คุณระงับบัญชีของตัวเองไม่ได้',
      });
    }

    if (target.role === 'SUPER_ADMIN') {
      // N13: confirmed by the project owner. Refusing is the direction that can be loosened
      // later — the opposite lets a single compromised admin account remove everyone who could
      // stop it.
      throw new AppException('FORBIDDEN', {
        message: 'ระงับบัญชีผู้ดูแลระบบสูงสุดผ่านหน้านี้ไม่ได้',
      });
    }

    if (target.bannedAt !== null) {
      // Already banned. Answering CONFLICT rather than quietly succeeding, so that two admins
      // acting at once do not both believe they were the one who did it — and so the audit log
      // does not grow a second entry describing a change that did not happen.
      throw new AppException('CONFLICT', { message: 'บัญชีนี้ถูกระงับอยู่แล้ว' });
    }

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      // §91: "not banned yet" rides on the write. The check above is only the fast, clear answer —
      // two admins acting at once both passed it, and both bans (and both audit entries) landed.
      const banned = await tx.user.updateMany({ where: { id: target.id, bannedAt: null }, data: { bannedAt: now } });
      if (banned.count === 0) {
        throw new AppException('CONFLICT', { message: 'บัญชีนี้ถูกระงับอยู่แล้ว' });
      }

      // In the transaction: an audit entry that survives a rolled-back ban is a record of
      // something that never happened, which is worse than no record.
      await this.audit.record(
        {
          actorUserId,
          action: 'USER_BANNED',
          targetType: 'USER',
          targetId: target.id,
          reason,
        },
        tx,
      );

      // #61 (I10): freeze this person's own in-flight orders as a buyer, and every in-flight order
      // any shop they own is selling.
      await this.orderFreeze.freezeOrdersForAccount(tx, actorUserId, target.id, now);
    });

    // Outside the transaction on purpose. The ban is what matters and it is already durable; if
    // revoking fails, the guard still refuses every request from this account on the strength of
    // the flag alone. Inside, a slow updateMany over somebody's twenty devices would hold the
    // transaction open for no gain.
    const endedSessions = await this.sessions.revokeAllForUser(target.id);

    this.logger.log(`USER_BANNED: ${String(endedSessions)} session(s) ended`);
  }

  /**
   * Lifts a ban.
   *
   * Does not restore the sessions it ended — they are gone, and the person signs in again. Reviving
   * a revoked session would mean a token that was dead for a month works again, which is not
   * something this system should be able to do at all.
   *
   * No reason is required, because USER_UNBANNED is not in ACTIONS_REQUIRING_REASON: the actions
   * that need one are the ones that take something away.
   *
   * #61: removes the `BUYER_BANNED`/`SELLER_BANNED` freeze reason this same ban added — an order
   * also frozen for another live reason (the shop it belongs to being separately suspended, say)
   * stays frozen, per `OrderFreezeService.removeReason`'s own stacking rule.
   *
   * §87 (owner's decision): also withdraws an erasure a super admin queued for this account under
   * #74 — that door is only open to banned accounts, so the request rested on the ban being lifted
   * here. One the account holder queued themselves stays: it rests on nothing an admin can undo.
   * Done under the account's row lock, the same one the queue sweep's erasure takes, so a sweep
   * already past its first look either erases before this commits or finds nothing queued after.
   */
  async unban(actorUserId: string, targetUserId: string): Promise<void> {
    const target = await this.requireTarget(targetUserId);

    if (target.bannedAt === null) {
      throw new AppException('CONFLICT', { message: 'บัญชีนี้ไม่ได้ถูกระงับอยู่' });
    }

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await lockAccountRow(tx, target.id);
      const locked = await tx.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { bannedAt: true, erasedAt: true, erasureRequestedAt: true, erasureRequestedBy: true },
      });
      // §91: re-checked under the lock — a second unban arriving together used to pass the check
      // above as well and record a second USER_UNBANNED.
      if (locked.bannedAt === null) {
        throw new AppException('CONFLICT', { message: 'บัญชีนี้ไม่ได้ถูกระงับอยู่' });
      }
      const withdrawsAdminErasure =
        locked.erasedAt === null && locked.erasureRequestedAt !== null && locked.erasureRequestedBy !== target.id;

      await tx.user.update({
        where: { id: target.id },
        data: { bannedAt: null, ...(withdrawsAdminErasure ? { erasureRequestedAt: null, erasureRequestedBy: null } : {}) },
      });

      await this.audit.record(
        { actorUserId, action: 'USER_UNBANNED', targetType: 'USER', targetId: target.id },
        tx,
      );
      if (withdrawsAdminErasure) {
        await this.audit.record(
          {
            actorUserId,
            action: 'ACCOUNT_ERASURE_CANCELLED',
            targetType: 'USER',
            targetId: target.id,
            reason: 'ปลดแบนแล้ว คำขอลบข้อมูลที่แอดมินยื่นแทนบัญชีที่ถูกแบนจึงถูกยกเลิก (§87)',
          },
          tx,
        );
      }

      await this.orderFreeze.unfreezeOrdersForAccount(tx, actorUserId, target.id, now);
    });
  }

  /**
   * §112 (the owner's decision): a super admin finds an account by its exact address — the one way
   * to learn the id that banning and appointing take. Exact, not partial, so it never turns into a
   * way to page through everyone's addresses. An erased account's address is a placeholder, so it
   * is never found here.
   */
  async findByEmail(email: string): Promise<UserLookupDto> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerifiedAt: true,
        bannedAt: true,
        erasedAt: true,
        communityAdmins: { select: { communityId: true }, orderBy: { id: 'asc' } },
        shops: { where: { closedAt: null }, select: { id: true } },
      },
    });
    if (user === null || user.erasedAt !== null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบบัญชีที่ใช้อีเมลนี้' });
    }

    return UserLookupDto.from({
      ...user,
      adminCommunityIds: user.communityAdmins.map((row) => row.communityId),
      hasOpenShop: user.shops.length > 0,
    });
  }

  /**
   * Promotes a verified user to SUPER_ADMIN.
   */
  async grantSuperAdmin(actorUserId: string, targetUserId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, emailVerifiedAt: true, erasedAt: true },
    });

    if (target === null || target.erasedAt !== null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบผู้ใช้นี้' });
    }
    if (target.emailVerifiedAt === null) {
      throw new AppException('CONFLICT', { message: 'ผู้ใช้ต้องยืนยันอีเมลก่อนจึงจะรับสิทธิ์นี้ได้' });
    }
    if (target.role === 'SUPER_ADMIN') {
      throw new AppException('CONFLICT', { message: 'บัญชีนี้เป็นผู้ดูแลระบบสูงสุดอยู่แล้ว' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { role: 'SUPER_ADMIN' },
      });

      await this.audit.record(
        { actorUserId, action: 'SUPER_ADMIN_GRANTED', targetType: 'USER', targetId: target.id },
        tx,
      );
    });
  }

  /**
   * Demotes a SUPER_ADMIN back to a normal USER.
   */
  async revokeSuperAdmin(actorUserId: string, targetUserId: string): Promise<void> {
    if (actorUserId === targetUserId) {
      throw new AppException('CONFLICT', { message: 'ไม่สามารถถอดถอนสิทธิ์ของตัวเองได้' });
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, erasedAt: true },
    });

    if (target === null || target.erasedAt !== null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบผู้ใช้นี้' });
    }
    if (target.role !== 'SUPER_ADMIN') {
      throw new AppException('CONFLICT', { message: 'บัญชีนี้ไม่ได้เป็นผู้ดูแลระบบสูงสุด' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { role: 'USER' },
      });

      await this.audit.record(
        { actorUserId, action: 'SUPER_ADMIN_REVOKED', targetType: 'USER', targetId: target.id },
        tx,
      );
    });
  }

  private async requireTarget(userId: string): Promise<{
    id: string;
    role: 'USER' | 'SUPER_ADMIN';
    bannedAt: Date | null;
  }> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, bannedAt: true },
    });

    if (target === null) {
      throw new AppException('NOT_FOUND');
    }

    return target;
  }
}
