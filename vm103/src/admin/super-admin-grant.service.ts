import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AppConfig } from '../config/app-config.module.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { PASSWORD_RESET_TTL_HOURS } from '../auth/auth-policy.js';
import { AccountMarkerService } from '../auth/account-marker.service.js';
import { VerificationTokenService } from '../auth/verification-token.service.js';
import { newId } from '../common/id.js';
import { isUniqueViolation } from '../common/errors/prisma-errors.js';
import { lockAccountRowsInIdOrder } from '../common/live-account-lock.js';
import { AppException } from '../common/errors/app-exception.js';
import { communityAdminGrantEntry, ownsOpenShop, requireActingSuperAdmin } from '../community/community-admin-scope.js';
import { EmailSender, EmailResult } from '../email/email-sender.js';
import { FrontendLinks } from '../email/frontend-links.js';
import { NotificationService } from '../notification/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SuperAdminAppointmentDto } from './dto/appoint-super-admin.dto.js';
import { Clock } from '../time/clock.js';

/** Why an existing account cannot be made a super admin — one word per case, each caller words it its own way. */
export type AccountRefusal = 'ALREADY_SUPER_ADMIN' | 'SUPER_ADMIN_BANNED' | 'BANNED' | 'UNVERIFIED' | 'OPEN_SHOP' | 'LOST_RACE';

/** The first super admin may also be refused because the address belongs to an erased account. */
export type FirstGrantRefusal = AccountRefusal | 'ERASED';

export type FirstGrantResult =
  | { readonly granted: 'INVITED'; readonly userId: string; readonly invitation: EmailResult }
  | { readonly granted: 'PROMOTED'; readonly userId: string }
  | { readonly refused: FirstGrantRefusal };

/** What `promoteIfEligible` reads about the account at an address. */
interface CandidateAccount {
  readonly id: string;
  readonly role: UserRole;
  readonly emailVerifiedAt: Date | null;
  readonly bannedAt: Date | null;
}

type PromotionResult = { readonly promoted: true; readonly userId: string; readonly foldedCommunityIds: string[] } | { readonly refused: AccountRefusal };

/**
 * The words a super admin sees when an appointment is refused — each says what would let it through.
 * `NO_ACCOUNT` is the appointment's own: only the first super admin is invited (§125 scrutinize).
 */
const APPOINTMENT_REFUSAL: Record<AccountRefusal | 'NO_ACCOUNT', string> = {
  NO_ACCOUNT: 'ไม่พบบัญชีของอีเมลนี้ ให้เจ้าของอีเมลสมัครและยืนยันอีเมลก่อน แล้วค่อยแต่งตั้ง',
  ALREADY_SUPER_ADMIN: 'บัญชีนี้เป็นผู้ดูแลระบบสูงสุดอยู่แล้ว',
  // Lifting the ban is all it takes — the role was never taken away.
  SUPER_ADMIN_BANNED: 'บัญชีนี้เป็นผู้ดูแลระบบสูงสุดอยู่แล้ว แต่ถูกระงับอยู่',
  BANNED: 'บัญชีนี้ถูกระงับอยู่ ต้องยกเลิกการระงับก่อนจึงจะแต่งตั้งได้',
  UNVERIFIED: 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล ให้เจ้าของบัญชียืนยันอีเมลก่อน',
  OPEN_SHOP: 'ผู้ใช้นี้ยังมีร้านที่เปิดอยู่ ต้องปิดร้านก่อนจึงจะแต่งตั้งเป็นผู้ดูแลระบบได้',
  LOST_RACE: 'บัญชีนี้เพิ่งมีการเปลี่ยนแปลง กรุณาลองอีกครั้ง',
};

/**
 * Who is promoting an account: the system setting up the first super admin from `SUPER_ADMIN_EMAIL`
 * (§124), or a super admin appointing another (§125). The audit action follows it, and so does the
 * appointer's row lock in `promote` — the system has no row to lock.
 */
type Grantor = { readonly kind: 'system' } | { readonly kind: 'super-admin'; readonly userId: string };

/**
 * §125: the one way an account becomes a super admin — shared by the first one (§124's boot task)
 * and every later one (a super admin's appointment), so the two can never disagree on who qualifies.
 *
 * - **a verified account has the address** → promoted at once, with an in-app notice (the owner's
 *   choice — no email). Its community-admin rows go in the same transaction: a super admin passes
 *   every community already, and a row for one would only mislead the admin list (§112);
 * - **unverified, banned, or still running a shop (N29)** → refused, nothing written;
 * - **no account has the address** → only the first super admin is invited: an account is made
 *   with the role and **no password**, and a one-time link to set one goes to that mailbox (§124).
 *   An appointment refuses instead (§125 scrutinize, owner's decision): an invitation to a mistyped
 *   address would be a super admin nobody can remove through the system (D2), where a refusal costs
 *   one more step — the person signs up first, the same as for a community admin (§112).
 */
@Injectable()
export class SuperAdminGrantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VerificationTokenService,
    private readonly email: EmailSender,
    private readonly links: FrontendLinks,
    private readonly audit: AuditLogService,
    private readonly markers: AccountMarkerService,
    private readonly notifications: NotificationService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  /**
   * §125: a super admin appointing another, by email. Effective at once for a verified account —
   * the role is read from the database on every request (invariant 7), so no new sign-in is needed.
   * Answered with what happened; every refusal is a 409 saying what to fix. `address` is already
   * normalised by `@EmailField()`.
   */
  async appoint(actorUserId: string, address: string): Promise<SuperAdminAppointmentDto> {
    const existing = await this.findAccount(address);
    if (existing === null) {
      // An erased account leaves no row with this address either — "no account" is the truth for it.
      throw new AppException('CONFLICT', { message: APPOINTMENT_REFUSAL.NO_ACCOUNT });
    }
    const result = await this.promoteIfEligible(existing, { kind: 'super-admin', userId: actorUserId });
    if ('refused' in result) {
      throw new AppException('CONFLICT', { message: APPOINTMENT_REFUSAL[result.refused] });
    }

    return { outcome: 'PROMOTED', userId: result.userId, foldedCommunityIds: result.foldedCommunityIds };
  }

  /** §124: the first super admin, from `SUPER_ADMIN_EMAIL` (already normalised by the boot task). */
  async grantFirst(address: string): Promise<FirstGrantResult> {
    const existing = await this.findAccount(address);

    if (existing === null) {
      // An erased account leaves no row with this address — erasure overwrites the email — only
      // its marker (§124 review R2).
      if (await this.markers.wasErased(address)) {
        return { refused: 'ERASED' };
      }
      return this.invite(address);
    }

    const result = await this.promoteIfEligible(existing, { kind: 'system' });
    return 'refused' in result ? result : { granted: 'PROMOTED', userId: result.userId };
  }

  private findAccount(address: string): Promise<CandidateAccount | null> {
    return this.prisma.user.findUnique({
      where: { email: address },
      select: { id: true, role: true, emailVerifiedAt: true, bannedAt: true },
    });
  }

  private async promoteIfEligible(existing: CandidateAccount, grantor: Grantor): Promise<PromotionResult> {
    if (existing.role === 'SUPER_ADMIN') {
      return { refused: existing.bannedAt === null ? 'ALREADY_SUPER_ADMIN' : 'SUPER_ADMIN_BANNED' };
    }
    if (existing.bannedAt !== null) {
      return { refused: 'BANNED' };
    }
    if (existing.emailVerifiedAt === null) {
      return { refused: 'UNVERIFIED' };
    }
    if (await ownsOpenShop(this.prisma, existing.id)) {
      return { refused: 'OPEN_SHOP' };
    }

    return this.promote(existing.id, grantor);
  }

  private async promote(userId: string, grantor: Grantor): Promise<PromotionResult> {
    return this.prisma.$transaction(async (tx): Promise<PromotionResult> => {
      // The person's row, as an appointment takes it (§112) — `ShopService.apply` takes the same row
      // and re-checks for admin rights under it — so a shop opened in the same instant either
      // commits first and is seen here, or waits and is refused (N29). The appointer's row too, in
      // id order with it (§125 review).
      await lockAccountRowsInIdOrder(tx, [userId, ...grantorIds(grantor)]);
      await requireGrantorStillAble(tx, grantor);
      if (await ownsOpenShop(tx, userId)) {
        return { refused: 'OPEN_SHOP' };
      }
      // Conditional, so a second grant racing this one (boot and sweep together, two super admins
      // pressing at once, a ban or an erasure landing first) changes nothing.
      const changed = await tx.user.updateMany({ where: { id: userId, role: 'USER', bannedAt: null, erasedAt: null }, data: { role: 'SUPER_ADMIN' } });
      if (changed.count === 0) {
        return { refused: 'LOST_RACE' };
      }

      const actorUserId = grantor.kind === 'super-admin' ? grantor.userId : null;
      // Ordered, so `foldedCommunityIds` reads the same every time for the same rows.
      const communityRows = await tx.communityAdmin.findMany({ where: { userId }, select: { communityId: true }, orderBy: { communityId: 'asc' } });
      if (communityRows.length > 0) {
        await tx.communityAdmin.deleteMany({ where: { userId } });
        for (const row of communityRows) {
          await this.audit.record(
            // The system grants only when no super admin exists, so a revocation it causes has no
            // person behind it either — the same null actor as the grant itself.
            communityAdminGrantEntry(actorUserId, 'COMMUNITY_ADMIN_REVOKED', userId, row.communityId),
            tx,
          );
        }
      }
      await this.recordGrant(tx, grantor, userId);
      await this.notifications.record(
        {
          userId,
          type: 'SUPER_ADMIN_APPOINTED',
          message:
            communityRows.length > 0
              ? 'คุณได้รับการแต่งตั้งเป็นผู้ดูแลระบบสูงสุด ดูแลได้ทุกชุมชน (สิทธิ์แอดมินชุมชนเดิมรวมอยู่ในนี้แล้ว)'
              : 'คุณได้รับการแต่งตั้งเป็นผู้ดูแลระบบสูงสุด ดูแลได้ทุกชุมชน',
        },
        tx,
      );

      return { promoted: true, userId, foldedCommunityIds: communityRows.map((row) => row.communityId) };
    });
  }

  private async invite(address: string): Promise<FirstGrantResult> {
    const created = await this.createInvitedAccount(address);
    if (created === null) {
      return { refused: 'LOST_RACE' };
    }

    const token = await this.tokens.issue(created.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_HOURS);
    const invitation = await this.email.send({
      to: address,
      kind: 'SUPER_ADMIN_INVITATION',
      subject: 'ตั้งรหัสผ่านเพื่อเริ่มใช้บัญชีผู้ดูแลระบบ — VRU Marketplace',
      body: [
        'สวัสดีครับ',
        '',
        'ระบบ VRU Marketplace เพิ่งเปิดใช้งาน และอีเมลนี้ถูกตั้งไว้เป็นผู้ดูแลระบบสูงสุด (super admin) คนแรก',
        // §128: the Google route is offered only on a deployment that has it — the first boot is
        // exactly when a site opens without a Google client, and this is the first email it sends.
        `กดลิงก์ด้านล่างเพื่อตั้งรหัสผ่าน แล้วเข้าสู่ระบบด้วยอีเมลนี้ได้ทันที${this.config.googleSignInEnabled ? ' (หรือกด "เข้าด้วย Google" ด้วยอีเมลนี้ก็ได้)' : ''}`,
        '',
        this.links.passwordReset(token),
        '',
        `ลิงก์นี้ใช้ได้ ${PASSWORD_RESET_TTL_HOURS} ชั่วโมง และใช้ได้ครั้งเดียว — ถ้าหมดอายุ ให้กด "ลืมรหัสผ่าน" ที่หน้าเข้าสู่ระบบด้วยอีเมลนี้`,
        '',
        'ถ้าคุณไม่ได้เกี่ยวข้องกับระบบนี้ ไม่ต้องทำอะไร และแจ้งผู้ดูแลระบบว่าตั้งอีเมลผิด',
      ].join('\n'),
    });

    return { granted: 'INVITED', userId: created.id, invitation };
  }

  /**
   * The account and its audit row — or `null` when another request got there first (boot and the
   * sweep together, or a person signing up with this address in the same instant: the unique email
   * decides · §124 review R3).
   */
  private async createInvitedAccount(address: string): Promise<{ id: string } | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: newId(),
            email: address,
            // No password, no Google: nobody can sign in until the mailbox proves itself — the
            // link sent below, or Google signing in with this address (`isInvitedSuperAdmin`).
            passwordHash: null,
            role: 'SUPER_ADMIN',
            createdAt: this.clock.now(),
          },
          select: { id: true },
        });
        await this.recordGrant(tx, { kind: 'system' }, user.id);

        return user;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  private recordGrant(tx: Prisma.TransactionClient, grantor: Grantor, userId: string): Promise<void> {
    return grantor.kind === 'system'
      ? this.audit.record({ actorUserId: null, action: 'SUPER_ADMIN_BOOTSTRAPPED', targetType: 'USER', targetId: userId }, tx)
      : this.audit.record({ actorUserId: grantor.userId, action: 'SUPER_ADMIN_APPOINTED', targetType: 'USER', targetId: userId }, tx);
  }
}

function grantorIds(grantor: Grantor): string[] {
  return grantor.kind === 'super-admin' ? [grantor.userId] : [];
}

/** Only a person's appointment can lose its right mid-request; the system is always able. */
async function requireGrantorStillAble(tx: Prisma.TransactionClient, grantor: Grantor): Promise<void> {
  if (grantor.kind === 'super-admin') {
    await requireActingSuperAdmin(tx, grantor.userId);
  }
}
