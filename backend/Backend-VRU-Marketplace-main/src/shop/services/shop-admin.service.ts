import { Injectable } from '@nestjs/common';
import { Prisma, ShopApprovalStatus, UserRole } from '@prisma/client';
import { AuditLogService } from '../../audit/audit-log.service.js';
import { AccountMarkerService } from '../../auth/account-marker.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { keysetAfter, newestFirst } from '../../common/pagination/keyset.js';
import { Page, toPage } from '../../common/pagination/page.js';
import { communityFilterFor, inCommunities } from '../../community/community-admin-scope.js';
import { NotificationService } from '../../notification/notification.service.js';
import { OrderFreezeService } from '../../order/services/order-freeze.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { MyShopDto } from '../dto/my-shop.dto.js';
import { ShopAdminDto } from '../dto/shop-admin.dto.js';
import { ShopProfileChangeDto } from '../dto/shop-profile-change.dto.js';
import { DROPPED_PROFILE_CHANGE, ShopService } from './shop.service.js';

/** The name the "pending review" cursor carries — a different list from the public one. */
const PENDING_LIST_NAME = 'shopsPending';

/**
 * §93: every admin view of a shop carries its owner's ban (`ShopAdminDto.ownerBannedAt`) · §97: and
 * the email address K16's marker is looked up by (`ownerPriorDisputeLostCount`) — never sent out —
 * and the current account's own losses beside it (`ownerDisputeLostCount`).
 */
const SHOP_ADMIN_INCLUDE = { 
  owner: { select: { bannedAt: true, disputeLostCount: true, email: true } },
  _count: { select: { followers: true } },
} satisfies Prisma.ShopInclude;
type ShopAdminRow = Prisma.ShopGetPayload<{ include: typeof SHOP_ADMIN_INCLUDE }>;

/** §86: the cursor name for the queue of waiting profile changes — its own list again. */
const PROFILE_CHANGE_LIST_NAME = 'shopProfileChanges';

/** §86: approve/reject on a shop with nothing waiting — already decided, or never submitted. */
const NO_PROFILE_CHANGE = 'ร้านนี้ไม่มีการแก้ไขข้อมูลที่รอตรวจ';


@Injectable()
export class ShopAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
    private readonly orderFreeze: OrderFreezeService,
    private readonly notifications: NotificationService,
    private readonly shopService: ShopService,
    private readonly markers: AccountMarkerService,
  ) {}

  /**
   * shops are left out: nothing is waiting on them (see `updateProfile`).
   */
  async pendingProfileChanges(
    actorUserId: string,
    role: UserRole,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ShopProfileChangeDto>> {
    const communityFilter = await communityFilterFor(this.prisma, actorUserId, role);
    if (communityFilter === 'none') {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.shop.findMany({
      where: {
        ...keysetAfter(cursor, PROFILE_CHANGE_LIST_NAME),
        profileChangeRequestedAt: { not: null },
        closedAt: null,
        ...inCommunities(communityFilter),
      },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, PROFILE_CHANGE_LIST_NAME);

    return { ...page, items: page.items.map((row) => ShopProfileChangeDto.from(row)) };
  }

  /**
   * §86: a community admin puts the waiting change live. Under the shop's row lock, so two admins
   * (or an admin and a fresh submission) never interleave — the change approved is exactly the one
   * this read. The logo it replaces is deleted after commit (K1). The owner may not approve their
   * own shop's change (N28 — reachable only for an owner made super admin in the database, N29).
   */
  async approveProfileChange(actorUserId: string, shopId: string, reviewRevision: number): Promise<MyShopDto> {
    const { updated, replaced } = await this.prisma.$transaction(async (tx) => {
      const current = await this.shopService.lockShop(tx, shopId);
      this.refuseOwnShop(current.ownerId, actorUserId);
      refuseNoProfileChange(current);
      refuseStaleShopReview(current.reviewRevision, reviewRevision);

      const data: Prisma.ShopUpdateInput = {
        pendingName: null,
        pendingDescription: null,
        pendingLogoFile: { disconnect: true },
        profileChangeRequestedAt: null,
      };
      if (current.pendingName !== null) {
        data.name = current.pendingName;
        data.description =
          current.pendingDescription !== null && current.pendingDescription.length > 0
            ? current.pendingDescription
            : null;
      }
      if (current.pendingLogoFileId !== null) {
        data.logoFile = { connect: { id: current.pendingLogoFileId } };
      }
      const result = await tx.shop.update({ where: { id: shopId }, data });

      await this.audit.record(
        {
          actorUserId,
          action: 'SHOP_PROFILE_APPROVED',
          targetType: 'SHOP',
          targetId: shopId,
          communityId: current.communityId,
        },
        tx,
      );

      return {
        updated: result,
        replaced: current.pendingLogoFileId !== null ? current.logoFileId : null,
      };
    });

    await this.shopService.discardQuietly(replaced);
    await this.notifications.notify({
      userId: updated.ownerId,
      type: 'SHOP_PROFILE_APPROVED',
      message: 'การแก้ไขชื่อ/คำอธิบาย/โลโก้ร้านของคุณได้รับการอนุมัติแล้ว',
      targetType: 'SHOP',
      targetId: shopId,
    });

    return MyShopDto.from(updated);
  }

  /** §86: a community admin drops the waiting change, with a reason the owner reads on `GET /shops/me`. */
  async rejectProfileChange(
    actorUserId: string,
    shopId: string,
    reason: string,
    reviewRevision: number,
  ): Promise<MyShopDto> {
    const now = this.clock.now();
    const { updated, dropped } = await this.prisma.$transaction(async (tx) => {
      const current = await this.shopService.lockShop(tx, shopId);
      this.refuseOwnShop(current.ownerId, actorUserId);
      refuseNoProfileChange(current);
      refuseStaleShopReview(current.reviewRevision, reviewRevision);

      const result = await tx.shop.update({
        where: { id: shopId },
        data: {
          ...DROPPED_PROFILE_CHANGE,
          profileChangeRejectionReason: reason,
          profileChangeRejectedAt: now,
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'SHOP_PROFILE_REJECTED',
          targetType: 'SHOP',
          targetId: shopId,
          reason,
          communityId: current.communityId,
        },
        tx,
      );

      return { updated: result, dropped: current.pendingLogoFileId };
    });

    await this.shopService.discardQuietly(dropped);
    await this.notifications.notify({
      userId: updated.ownerId,
      type: 'SHOP_PROFILE_REJECTED',
      message: `การแก้ไขชื่อ/คำอธิบาย/โลโก้ร้านของคุณไม่ผ่านการตรวจ: ${reason}`,
      targetType: 'SHOP',
      targetId: shopId,
    });

    return MyShopDto.from(updated);
  }

  /** N28 — the same refusal `approve`/`suspend` already make, for §86's profile review. */
  private refuseOwnShop(ownerId: string, actorUserId: string): void {
    if (ownerId === actorUserId) {
      throw new AppException('FORBIDDEN', { message: 'คุณตรวจการแก้ไขร้านของตัวเองไม่ได้' });
    }
  }

  /**
   * Approves a PENDING shop. Guard-checked entirely by `CommunityScopeGuard` (#32) before this
   * runs — this only has to enforce what the guard cannot know: the shop is still awaiting
   * review, and the approver is not the shop's own owner.
   */
  async approve(actorUserId: string, shopId: string, reviewRevision: number): Promise<ShopAdminDto> {
    const shop = await this.requirePending(shopId, actorUserId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.decideApplication(tx, shopId, reviewRevision, { approvalStatus: 'APPROVED' });

      await this.audit.record(
        {
          actorUserId,
          action: 'SHOP_APPROVED',
          targetType: 'SHOP',
          targetId: shopId,
          communityId: shop.communityId,
        },
        tx,
      );

      return result;
    });

    await this.notifications.notify({
      userId: updated.ownerId,
      type: 'SHOP_APPROVED',
      message: 'ร้านของคุณได้รับการอนุมัติแล้ว เริ่มขายของได้เลย',
      targetType: 'SHOP',
      targetId: shopId,
    });

    return this.toAdminDto(updated);
  }

  /**
   * Rejects a PENDING shop, with a reason the applicant will read on their own `GET /shops/me`.
   *
   * Also sets `closedAt`: a rejected shop never opened, and the partial unique index only frees
   * an owner's slot when `closedAt` is set — without this, spec 4/12's "ยื่นใหม่ได้" (apply
   * again) would be blocked by the rejected row occupying the owner's one shop forever (N28).
   */
  async reject(actorUserId: string, shopId: string, reason: string, reviewRevision: number): Promise<ShopAdminDto> {
    const shop = await this.requirePending(shopId, actorUserId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.decideApplication(tx, shopId, reviewRevision, {
        approvalStatus: 'REJECTED',
        rejectionReason: reason,
        closedAt: this.clock.now(),
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'SHOP_REJECTED',
          targetType: 'SHOP',
          targetId: shopId,
          communityId: shop.communityId,
          reason,
        },
        tx,
      );

      return result;
    });

    // Code review (2026-09-22, §77): the one moderation outcome in the system that told nobody —
    // PRODUCT_REJECTED already notifies its applicant, and this is the same shape of "you have to
    // act on this" event `approve()` above already sends for the opposite outcome.
    await this.notifications.notify({
      userId: updated.ownerId,
      type: 'SHOP_REJECTED',
      message: `คำขอเปิดร้านของคุณถูกปฏิเสธ: ${reason}`,
      targetType: 'SHOP',
      targetId: shopId,
    });

    return this.toAdminDto(updated);
  }

  /**
   * §91: the one write both application decisions make — conditional on the shop still being
   * PENDING *and* on the revision the reviewer saw. Two reviewers at once used to both succeed (two
   * audit entries, two notices, and an approve racing a reject could leave the owner told both); an
   * edit after the reviewer opened it used to be approved unseen.
   */
  async decideApplication(
    tx: Prisma.TransactionClient,
    shopId: string,
    reviewRevision: number,
    data: Prisma.ShopUpdateManyMutationInput,
  ): Promise<ShopAdminRow> {
    const changed = await tx.shop.updateMany({ where: { id: shopId, approvalStatus: 'PENDING', reviewRevision }, data });
    if (changed.count === 0) {
      const current = await tx.shop.findUnique({ where: { id: shopId }, select: { approvalStatus: true } });
      if (current?.approvalStatus === 'PENDING') {
        throw new AppException('STALE_VIEW', { message: 'คำขอเปิดร้านนี้ถูกแก้ไขหลังจากที่คุณเปิดดู กรุณาโหลดใหม่แล้วตรวจฉบับล่าสุดก่อนตัดสิน' });
      }
      throw new AppException('CONFLICT', { message: 'คำขอนี้ถูกตัดสินไปแล้ว' });
    }

    return tx.shop.findUniqueOrThrow({ where: { id: shopId }, include: SHOP_ADMIN_INCLUDE });
  }

  /** Shared by `approve` and `reject`: the checks neither the guard nor the route can express. */
  async requirePending(
    shopId: string,
    actorUserId: string,
  ): Promise<{ id: string; ownerId: string; communityId: string; approvalStatus: string }> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, ownerId: true, communityId: true, approvalStatus: true },
    });
    // CommunityScopeGuard already confirmed the shop exists (its resolver would have answered
    // 403 otherwise), so reaching null here would mean it was deleted in the instant between —
    // there is no delete path on Shop, so this is unreachable in practice.
    if (shop === null) {
      throw new AppException('NOT_FOUND');
    }

    if (shop.ownerId === actorUserId) {
      // N28: decided and written down, not left silent. A person can be both a shop's owner and
      // an admin of the community it belongs to at once — nothing stops that combination — but
      // letting them review their own application defeats the entire reason review exists: an
      // independent check. Applied to a super admin too, for the same reason B2 lets exactly one
      // shop exist per person regardless of role.
      throw new AppException('FORBIDDEN', { message: 'คุณอนุมัติหรือปฏิเสธร้านของตัวเองไม่ได้' });
    }

    if (shop.approvalStatus !== 'PENDING') {
      // Same shape as AdminUsersService.ban() answering CONFLICT for an already-banned account:
      // a decision that has already been made is a state conflict, not a missing resource.
      throw new AppException('CONFLICT', { message: 'คำขอนี้ถูกตัดสินไปแล้ว' });
    }

    return shop;
  }

  /**
   * Suspends an approved shop (#38, J2): no new sales, but nothing here blocks finishing orders
   * already in progress — that is enforced by *not* checking suspension anywhere near an order
   * or product action, not by a broad guard (see this ticket's own acceptance criteria on why a
   * blanket "suspended shops can't do X" check is the wrong shape). `LIVE_SHOP_FILTER` is what
   * actually hides a suspended shop's storefront.
   */
  async suspend(actorUserId: string, shopId: string, reason: string): Promise<ShopAdminDto> {
    const shop = await this.requireNotOwnSuspendable(shopId, actorUserId);
    refuseUnsuspendable(shop);

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      // §91: "not suspended yet" rides on the write — two admins at once used to both succeed,
      // recording two suspensions and telling the owner twice. §109: so do "approved" and "open" —
      // the owner closing at the same moment must not end with a closed shop suspended anyway.
      const changed = await tx.shop.updateMany({
        where: { id: shopId, suspendedAt: null, approvalStatus: 'APPROVED', closedAt: null },
        data: { suspendedAt: now },
      });
      if (changed.count === 0) {
        refuseUnsuspendable(await tx.shop.findUniqueOrThrow({ where: { id: shopId }, select: { suspendedAt: true, approvalStatus: true, closedAt: true } }));
      }
      const result = await tx.shop.findUniqueOrThrow({ where: { id: shopId }, include: SHOP_ADMIN_INCLUDE });

      await this.audit.record(
        {
          actorUserId,
          action: 'SHOP_SUSPENDED',
          targetType: 'SHOP',
          targetId: shopId,
          communityId: shop.communityId,
          reason,
        },
        tx,
      );

      // #61 (H2/I10): freeze every non-terminal order this shop is selling, through the one
      // mechanism every freeze trigger shares. J2's own guards (shipping.service.ts,
      // payment-slip.service.ts's shop-side actions) already know not to let this block the
      // shop's own remaining duties.
      await this.orderFreeze.freezeOrdersForShop(tx, actorUserId, shopId, 'SHOP_SUSPENDED', now);

      return result;
    });

    await this.notifications.notify({
      userId: updated.ownerId,
      type: 'SHOP_SUSPENDED',
      message: 'ร้านของคุณถูกระงับชั่วคราว ขายของใหม่ไม่ได้จนกว่าจะถูกปลดระงับ',
      targetType: 'SHOP',
      targetId: shopId,
    });

    return this.toAdminDto(updated);
  }

  /**
   * Lifts a suspension (#38). No reason required — `SHOP_UNSUSPENDED` mirrors `USER_UNBANNED`.
   *
   * #62 (I4b): auto-unfreezes every order this shop has that's still frozen for
   * `SHOP_SUSPENDED` — and, because `OrderFreezeService.unfreezeOrdersForShop` only removes that
   * one reason, this is *already* "only the orders an admin hasn't ruled on individually" without
   * any extra bookkeeping: a ruling (#62's `FrozenOrderService.rule`) calls `forceUnfreeze`, which
   * deletes every stacked reason at once, so a ruled order's `frozenAt` is already null and this
   * call's own `frozenAt: { not: null }` filter simply skips it. An order still frozen for a
   * *second*, unrelated reason (e.g. `PRODUCT_PROHIBITED`) stays frozen — only that one reason
   * clears.
   */
  async unsuspend(actorUserId: string, shopId: string): Promise<ShopAdminDto> {
    const shop = await this.requireNotOwnSuspendable(shopId, actorUserId);

    if (shop.suspendedAt === null) {
      throw new AppException('CONFLICT', { message: 'ร้านนี้ไม่ได้ถูกระงับอยู่' });
    }

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.shop.updateMany({ where: { id: shopId, suspendedAt: { not: null } }, data: { suspendedAt: null } });
      if (changed.count === 0) {
        throw new AppException('CONFLICT', { message: 'ร้านนี้ไม่ได้ถูกระงับอยู่' });
      }
      const result = await tx.shop.findUniqueOrThrow({ where: { id: shopId }, include: SHOP_ADMIN_INCLUDE });

      await this.audit.record(
        {
          actorUserId,
          action: 'SHOP_UNSUSPENDED',
          targetType: 'SHOP',
          targetId: shopId,
          communityId: shop.communityId,
        },
        tx,
      );

      await this.orderFreeze.unfreezeOrdersForShop(tx, actorUserId, shopId, 'SHOP_SUSPENDED', now);

      return result;
    });

    await this.notifications.notify({
      userId: updated.ownerId,
      type: 'SHOP_UNSUSPENDED',
      message: 'ร้านของคุณถูกปลดระงับแล้ว ขายของใหม่ได้ตามปกติ',
      targetType: 'SHOP',
      targetId: shopId,
    });

    return this.toAdminDto(updated);
  }

  /**
   * Shared by `suspend` and `unsuspend`: the shop must exist, and the caller may not be its own
   * owner. The self-dealing block is N28's — approving your own shop and lifting your own
   * suspension are the same conflict of interest (an admin who is also the affected owner making
   * a decision that should be independent of them), so this extends that reasoning rather than
   * inventing a second rule for a structurally identical situation.
   */
  async requireNotOwnSuspendable(
    shopId: string,
    actorUserId: string,
  ): Promise<{ id: string; ownerId: string; communityId: string; suspendedAt: Date | null; approvalStatus: ShopApprovalStatus; closedAt: Date | null }> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, ownerId: true, communityId: true, suspendedAt: true, approvalStatus: true, closedAt: true },
    });
    if (shop === null) {
      throw new AppException('NOT_FOUND');
    }

    if (shop.ownerId === actorUserId) {
      throw new AppException('FORBIDDEN', { message: 'คุณระงับหรือปลดระงับร้านของตัวเองไม่ได้' });
    }

    return shop;
  }

  /**
   * Pending applications the caller may act on — every one, for a super admin, or only those in
   * communities the caller administers. Not gated by `CommunityScopeGuard`: that guard checks one
   * target's community against the caller, and this route has no single target — it is scoped by
   * filtering the query instead.
   */
  async pending(
    actorUserId: string,
    role: UserRole,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ShopAdminDto>> {
    const communityFilter = await communityFilterFor(this.prisma, actorUserId, role);
    if (communityFilter === 'none') {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.shop.findMany({
      where: {
        ...keysetAfter(cursor, PENDING_LIST_NAME),
        approvalStatus: 'PENDING',
        ...inCommunities(communityFilter),
      },
      orderBy: newestFirst(),
      take: limit + 1,
      include: SHOP_ADMIN_INCLUDE,
    });

    const page = toPage(rows, limit, PENDING_LIST_NAME);

    return { ...page, items: await this.toAdminDtos(page.items) };
  }

  /** */
  async findAdmin(id: string): Promise<ShopAdminDto> {
    const shop = await this.prisma.shop.findUnique({ where: { id }, include: SHOP_ADMIN_INCLUDE });
    if (shop === null) {
      throw new AppException('NOT_FOUND');
    }

    return this.toAdminDto(shop);
  }


  async toAdminDto(shop: ShopAdminRow): Promise<ShopAdminDto> {
    const [dto] = await this.toAdminDtos([shop]);

    return dto!;
  }

  /** §97 (K16): every admin view of a shop goes through here, with the marker read in one batch. */
  async toAdminDtos(shops: readonly ShopAdminRow[]): Promise<ShopAdminDto[]> {
    const losses = await this.markers.priorDisputeLosses(shops.map((shop) => shop.owner.email));

    return shops.map((shop) => ShopAdminDto.from(shop, losses.get(shop.owner.email) ?? 0));
  }
}

/**
 * §86 · §109: nothing to decide — no change waiting, or the shop has closed (a change left waiting
 * on a shop that closed before §109 dropped it on closing).
 */
function refuseNoProfileChange(shop: { profileChangeRequestedAt: Date | null; closedAt: Date | null }): void {
  if (shop.profileChangeRequestedAt === null) {
    throw new AppException('CONFLICT', { message: NO_PROFILE_CHANGE });
  }
  if (shop.closedAt !== null) {
    throw new AppException('CONFLICT', { message: 'ร้านนี้ปิดไปแล้ว การแก้ไขที่ค้างอยู่จึงไม่ต้องตรวจ' });
  }
}

/**
 * §109 (owner's decision): suspension stops a shop that is selling. One never approved has nothing
 * to stop — rejecting it is the tool — and a closed one has stopped already; suspending it only
 * froze its remaining orders for nothing. Someone who must be stopped for good is banned (§92).
 */
function refuseUnsuspendable(shop: { suspendedAt: Date | null; approvalStatus: ShopApprovalStatus; closedAt: Date | null }): void {
  if (shop.suspendedAt !== null) {
    throw new AppException('CONFLICT', { message: 'ร้านนี้ถูกระงับอยู่แล้ว' });
  }
  if (shop.approvalStatus !== 'APPROVED') {
    throw new AppException('CONFLICT', { message: 'ร้านนี้ยังไม่ได้รับอนุมัติ ระงับไม่ได้ — ใช้การปฏิเสธคำขอเปิดร้านแทน' });
  }
  if (shop.closedAt !== null) {
    throw new AppException('CONFLICT', { message: 'ร้านนี้ปิดไปแล้ว ระงับไม่ได้' });
  }
}

/** §91: a profile-change decision must be on the change the reviewer looked at. */
function refuseStaleShopReview(current: number, seen: number): void {
  if (current !== seen) {
    throw new AppException('STALE_VIEW', {
      message: 'ร้านนี้ส่งการแก้ไขใหม่หลังจากที่คุณเปิดดู กรุณาโหลดใหม่แล้วตรวจฉบับล่าสุดก่อนตัดสิน',
    });
  }
}
