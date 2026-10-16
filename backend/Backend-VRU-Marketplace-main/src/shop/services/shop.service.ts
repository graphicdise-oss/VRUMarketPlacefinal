import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma, Shop, UserRole } from '@prisma/client';
import { AuditLogService } from '../../audit/audit-log.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { lockLiveAccount } from '../../common/live-account-lock.js';
import { newId } from '../../common/id.js';
import { keysetAfter, newestFirst } from '../../common/pagination/keyset.js';
import { Page, toPage } from '../../common/pagination/page.js';
import { ADMIN_ACCOUNT_REFUSED, communityFilterFor, inCommunities, isAnyAdmin, requireCommunityForShare } from '../../community/community-admin-scope.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../../files/file-storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { UpdateShopDto } from '../dto/update-shop.dto.js';
import { ShopDto } from '../dto/shop.dto.js';
import { MyShopDto } from '../dto/my-shop.dto.js';
import { ShopProfileChangeDto } from '../dto/shop-profile-change.dto.js';
import { LIVE_SHOP_FILTER } from '../common/shop-visibility.js';
import { NON_TERMINAL_STATUSES } from "../../order/common/order-status-sets.js";

/** §86: the cursor name for the queue of waiting profile changes — its own list again. */
const PROFILE_CHANGE_LIST_NAME = 'shopProfileChanges';

/** §86: an approved shop that has closed takes no profile change (see `updateProfile`). */
const SHOP_CLOSED_NO_CHANGE = 'ร้านนี้ปิดไปแล้ว แก้ไขข้อมูลร้านไม่ได้';

/** §86 · §109: the fields a waiting profile change lives in, emptied — by a rejection, or by closing the shop. */
export const DROPPED_PROFILE_CHANGE = {
  pendingName: null,
  pendingDescription: null,
  pendingLogoFileId: null,
  profileChangeRequestedAt: null,
} satisfies Prisma.ShopUncheckedUpdateInput;
/** The name every cursor for this list carries, matching #18's per-list mismatch check. */
const LIST_NAME = 'shops';

/** #60: what a shop with zero (non-deleted) reviews shows — never a query, just the zero value. */
/** A shop's public rating summary (`ShopDto.averageRating`/`reviewCount`). */
export interface ReviewStats {
  readonly averageRating: number | null;
  readonly reviewCount: number;
}

export const EMPTY_REVIEW_STATS: ReviewStats = { averageRating: null, reviewCount: 0 };

const SHOP_CLOSE_BLOCKING_STATUSES: readonly OrderStatus[] = NON_TERMINAL_STATUSES.filter(
  (status: OrderStatus) => status !== 'SHIPPED',
);

/** #39: the short Thai reason shown beside each blocking order id in the 409's `fieldErrors`. */
function blockingReasonFor(order: { status: OrderStatus; frozenAt: Date | null }): string {
  if (order.frozenAt !== null) {
    return 'ถูกแช่แข็ง รอแอดมินตัดสิน';
  }

  switch (order.status) {
    case 'AWAITING_SHIPPING_QUOTE':
      return 'รอร้านใส่ค่าส่ง';
    case 'AWAITING_PAYMENT':
      return 'รอผู้ซื้อโอนเงิน';
    case 'PAYMENT_SUBMITTED':
      return 'รอร้านยืนยันเงินเข้า';
    case 'PAID':
      return 'จ่ายแล้ว รอร้านส่งของ';
    case 'REFUND_ORDERED':
      return 'ถูกสั่งให้คืนเงิน';
    default:
      // Unreachable — blockingOrders() only ever selects a frozen row (handled above) or a row
      // whose status is in SHOP_CLOSE_BLOCKING_STATUSES, which is exactly the five cases above.
      return 'ยังมีเรื่องที่ร้านต้องทำ';
  }
}

/**
 * `Shop` (#32's minimal scaffold, filled in by #34 and #35): applying, the public list, reading
 * one's own status, and now approving or rejecting a pending application. Payment channels
 * (#36), closing (#37) and suspension (#38) are each their own ticket's service method to add
 * here later — this file does not reach ahead of them.
 */
@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
    private readonly files: FileStorageService
  ) {}

  /**
   * Applies to open a shop. The caller already passed `@RequiresVerifiedEmail()` by the time this
   * runs (B0.1's one gate — see that decorator), so this only has to check the two things that
   * gate remembers nothing about: the community is real, and the caller does not already hold an
   * open shop.
   */
  async apply(ownerId: string, communityId: string, name: string): Promise<MyShopDto> {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { id: true },
    });
    if (community === null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบชุมชนนี้' });
    }

    const existing = await this.prisma.shop.findFirst({
      where: { ownerId, closedAt: null },
      select: { id: true },
    });
    if (existing !== null) {
      // B2: one shop per person, platform-wide. Answering CONFLICT rather than quietly returning
      // the existing shop means a client cannot mistake "you already have one" for "here is the
      // one you just asked for" — the two are different facts.
      throw new AppException('CONFLICT', {
        message: 'คุณมีร้านที่เปิดอยู่แล้ว เปิดร้านที่สองไม่ได้',
      });
    }

    try {
      // §87: the applicant's row `FOR SHARE` next to the insert — an application landing while the
      // same account's erasure commits used to leave a shop, named by its owner, on the erased account.
      const shop = await this.prisma.$transaction(async (tx) => {
        await lockLiveAccount(tx, ownerId);
        const account = await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { role: true } });
        // §112: admin rights read again under the row an appointment locks too
        // (`CommunityAdminService.assign`) — `@RefusesAdmins()` read them before this transaction,
        // and an appointment committed in between used to leave an admin running a shop (N29).
        if (await isAnyAdmin(tx, ownerId, account.role)) {
          throw new AppException('FORBIDDEN', { message: ADMIN_ACCOUNT_REFUSED });
        }
        await requireCommunityForShare(tx, communityId);
        return tx.shop.create({
          data: { id: newId(), communityId, ownerId, name, createdAt: this.clock.now() },
        });
      });

      return MyShopDto.from(shop);
    } catch (error) {
      // The check above loses the race when two applications from the same account arrive
      // together; `shop_owner_id_open_key` (the partial unique index — see the schema comment on
      // why it cannot be a plain `@unique`) catches it at the database, which is what the ticket's
      // "การกันร้านซ้ำเกิดที่ระดับฐานข้อมูล" requires. Mapped to the same 409 the check produces,
      // so the loser of that race gets a plain answer rather than a 500.
      if (isUniqueViolation(error)) {
        throw new AppException('CONFLICT', {
          message: 'คุณมีร้านที่เปิดอยู่แล้ว เปิดร้านที่สองไม่ได้',
        });
      }
      throw error;
    }
  }

  /**
   * The caller's own shop — the one view that shows PENDING or REJECTED.
   *
   * The *most recent* row for this owner, not "the open one": #35's reject sets `closedAt` on
   * the rejected row too (so the owner's one-shop slot frees up and they can apply again — see
   * that method's own comment), which would make a "closedAt IS NULL" filter go blank the moment
   * a rejection happens, hiding the very reason the applicant needs to read. Newest-first means a
   * fresh application after a rejection naturally takes over as "mine" the moment it exists.
   */
  async mine(ownerId: string): Promise<MyShopDto> {
    return MyShopDto.from(await this.findOwnShopRow(ownerId));
  }

  /**
   * The raw row behind `mine()` — extracted for #36's `PaymentChannelService`, which needs the
   * same "which shop is this person's" resolution but has no use for `MyShopDto`. Kept on
   * `ShopService` rather than duplicated: payment channels are owned by a shop, and this is the
   * one place that already knows how to find a caller's shop.
   */
  async findOwnShopRow(ownerId: string): Promise<Shop> {
    const shop = await this.prisma.shop.findFirst({
      where: { ownerId },
      // Tie-broken by id (UUIDv7, chronological — see #33's own use of the same trick): the
      // `Clock` in a test can hand two applications the exact same `createdAt`, and `createdAt`
      // alone would then pick between them arbitrarily.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (shop === null) {
      throw new AppException('NOT_FOUND', { message: 'คุณยังไม่มีร้าน' });
    }

    return shop;
  }

  /**
   * #73: full replace of the caller's own `name`/`description`.
   *
   * §86 (owner's decision): on a shop that is already **approved**, the change does not go live —
   * it waits in `pendingName`/`pendingDescription` for a community admin, while the storefront
   * keeps its current text (free text every buyer sees is I13's reason for reviewing product
   * names, and the shop must not disappear while it waits). A shop that was never approved has
   * nothing to wait for: its own approval is the review, so its edits apply directly. An approved
   * shop that has since closed takes no change at all — nobody would review a storefront that no
   * longer sells (⚠️ my own call, §86).
   *
   * §86 also locks the owner's user row `FOR SHARE` and refuses an erased account, the same pairing
   * `OrderService.checkout` has with PDPA erasure's `FOR UPDATE` (§84) — an edit that landed while
   * the erasure committed used to write the real name back over the placeholder.
   */
  async updateProfile(ownerId: string, dto: UpdateShopDto): Promise<MyShopDto> {
    const shop = await this.findOwnShopRow(ownerId);
    const now = this.clock.now();

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockLiveAccount(tx, ownerId);
      const current = await this.lockShop(tx, shop.id);

      if (current.approvalStatus !== 'APPROVED') {
        return tx.shop.update({
          where: { id: shop.id },
          data: {
            name: dto.name,
            description: dto.description.length > 0 ? dto.description : null,
            // §91: the application's reviewer must see this before deciding.
            reviewRevision: { increment: 1 },
          },
        });
      }
      if (current.closedAt !== null) {
        throw new AppException('CONFLICT', { message: SHOP_CLOSED_NO_CHANGE });
      }

      return tx.shop.update({
        where: { id: shop.id },
        data: {
          pendingName: dto.name,
          pendingDescription: dto.description,
          profileChangeRequestedAt: now,
          profileChangeRejectionReason: null,
          profileChangeRejectedAt: null,
          reviewRevision: { increment: 1 },
        },
      });
    });

    return MyShopDto.from(updated);
  }

  /**
   * #73: uploads (or replaces) the caller's own shop's storefront photo — validated, re-encoded,
   * and stripped of EXIF by `FileStorageService.storeImage` (K1), never a second image path.
   *
   * §86: goes live directly only on a shop that was never approved; on an approved one it becomes
   * the *pending* logo, for a community admin to approve with the rest of the change (see
   * `updateProfile`). Whichever file it replaces — the live logo or an earlier pending one — is
   * deleted once this commits: nothing else ever points at it again, and before §86 every replaced
   * logo stayed on disk for good, out of reach of the PDPA erasure that only knew the current one
   * (K1). A new file that ends up unused (erased owner, closed shop, any failure) is discarded too.
   */
  async setLogo(ownerId: string, upload: UploadedTempFile): Promise<MyShopDto> {
    const shop = await this.findOwnShopRow(ownerId);
    const stored = await this.files.storeImage(upload);
    const now = this.clock.now();

    const { updated, replaced } = await this.prisma
      .$transaction(async (tx) => {
        await lockLiveAccount(tx, ownerId);
        const current = await this.lockShop(tx, shop.id);

        if (current.approvalStatus !== 'APPROVED') {
          const result = await tx.shop.update({
            where: { id: shop.id },
            data: { logoFileId: stored.id, reviewRevision: { increment: 1 } },
          });
          return { updated: result, replaced: current.logoFileId };
        }
        if (current.closedAt !== null) {
          throw new AppException('CONFLICT', { message: SHOP_CLOSED_NO_CHANGE });
        }

        const result = await tx.shop.update({
          where: { id: shop.id },
          data: {
            pendingLogoFileId: stored.id,
            profileChangeRequestedAt: now,
            profileChangeRejectionReason: null,
            profileChangeRejectedAt: null,
            reviewRevision: { increment: 1 },
          },
        });
        return { updated: result, replaced: current.pendingLogoFileId };
      })
      .catch(async (error: unknown) => {
        await this.files.discardUnattached(stored.id);
        throw error;
      });

    await this.discardQuietly(replaced);

    return MyShopDto.from(updated);
  }

  /**
   * The public logo read (#73) — no ownership check and no `closedAt` gate, same reasoning
   * `ProductService.readImage` gives for a product photo: an old direct link (an order page, a
   * saved bookmark) should keep resolving rather than 404 the moment a shop closes.
   *
   * §86: but a shop that was never approved answers 404 to everyone except its own owner — the
   * same "does not exist to a stranger" rule `findPublic` applies to the shop itself; before, the
   * logo route confirmed the shop existed and served an image nobody had reviewed. `ownerOnly`
   * tells the controller to send that owner's copy as a private file, so no shared cache hands it
   * to the next (anonymous) caller of the same URL.
   */
  async readLogo(
    shopId: string,
    viewerId: string | null,
  ): Promise<{ image: ReadImage; ownerOnly: boolean }> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { logoFileId: true, approvalStatus: true, ownerId: true },
    });
    const ownerOnly = shop !== null && shop.approvalStatus !== 'APPROVED';
    if (shop === null || shop.logoFileId === null || (ownerOnly && shop.ownerId !== viewerId)) {
      throw new AppException('NOT_FOUND');
    }

    const image = await this.files.readImage(shop.logoFileId);
    if (image === null) {
      // Reachable only if the bytes went missing from disk (a restore that skipped the volume, say)
      // — answered as "no logo" rather than a 500.
      throw new AppException('NOT_FOUND');
    }

    return { image, ownerOnly };
  }

  /**
   * Upload or replace the shop's banner / cover image.
   */
  async setBanner(ownerId: string, upload: UploadedTempFile): Promise<MyShopDto> {
    const shop = await this.findOwnShopRow(ownerId);
    const stored = await this.files.storeImage(upload);

    const { updated, replaced } = await this.prisma
      .$transaction(async (tx) => {
        await lockLiveAccount(tx, ownerId);
        const current = await this.lockShop(tx, shop.id);

        if (current.closedAt !== null) {
          throw new AppException('CONFLICT', { message: SHOP_CLOSED_NO_CHANGE });
        }

        const result = await tx.shop.update({
          where: { id: shop.id },
          data: { bannerFileId: stored.id },
        });
        return { updated: result, replaced: current.bannerFileId };
      })
      .catch(async (error: unknown) => {
        await this.files.discardUnattached(stored.id);
        throw error;
      });

    await this.discardQuietly(replaced);

    return MyShopDto.from(updated);
  }

  /**
   * Delete the shop's banner image.
   */
  async deleteBanner(ownerId: string): Promise<MyShopDto> {
    const shop = await this.findOwnShopRow(ownerId);

    const { updated, replaced } = await this.prisma
      .$transaction(async (tx) => {
        await lockLiveAccount(tx, ownerId);
        const current = await this.lockShop(tx, shop.id);

        if (current.closedAt !== null) {
          throw new AppException('CONFLICT', { message: SHOP_CLOSED_NO_CHANGE });
        }

        const result = await tx.shop.update({
          where: { id: shop.id },
          data: { bannerFileId: null },
        });
        return { updated: result, replaced: current.bannerFileId };
      });

    await this.discardQuietly(replaced);

    return MyShopDto.from(updated);
  }

  /**
   * The public banner read.
   */
  async readBanner(
    shopId: string,
    viewerId: string | null,
  ): Promise<{ image: ReadImage; ownerOnly: boolean }> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { bannerFileId: true, approvalStatus: true, ownerId: true },
    });
    const ownerOnly = shop !== null && shop.approvalStatus !== 'APPROVED';
    if (shop === null || shop.bannerFileId === null || (ownerOnly && shop.ownerId !== viewerId)) {
      throw new AppException('NOT_FOUND');
    }

    const image = await this.files.readImage(shop.bannerFileId);
    if (image === null) {
      throw new AppException('NOT_FOUND');
    }

    return { image, ownerOnly };
  }


  /** §86: the owner's own look at the logo still waiting for review. */
  async readMyPendingLogo(ownerId: string): Promise<ReadImage> {
    const shop = await this.findOwnShopRow(ownerId);
    return this.readPendingLogoOf(shop.id);
  }

  /** §86: a community admin's look at the logo they are about to approve or reject (guard-checked by the controller). */
  async readPendingLogoOf(shopId: string): Promise<ReadImage> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { pendingLogoFileId: true },
    });
    const image = shop?.pendingLogoFileId
      ? await this.files.readImage(shop.pendingLogoFileId)
      : null;
    if (image === null) {
      throw new AppException('NOT_FOUND');
    }

    return image;
  }

  /**
   * §86: the waiting profile changes the caller may review — every community for a super admin,
   * their own for a community admin, nothing for anyone else (same scoping as `pending`). Closed
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

  public async lockShop(tx: Prisma.TransactionClient, shopId: string): Promise<Shop> {
    await tx.$queryRaw`SELECT id FROM shop WHERE id = ${shopId}::uuid FOR UPDATE`;
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (shop === null) {
      throw new AppException('NOT_FOUND');
    }

    return shop;
  }


  /** Deletes a logo file nothing points at any more (replaced, rejected, or dropped on closing); a failure is logged by id, never thrown past a committed change. */
  public async discardQuietly(fileId: string | null): Promise<void> {
    if (fileId === null) {
      return;
    }
    await this.files.discardUnattached(fileId).catch(() => {
      this.logger.warn(`Could not delete unused shop logo file ${fileId}; remove it by hand`);
    });
  }

  /**
   * Closes the caller's own shop (#37). Soft delete — `closedAt` is set, never a row `DELETE` —
   * because orders and reviews reference this row and spec 4/12 requires them to keep reading
   * correctly after the shop that made them is gone. Frees the owner's one-shop slot the same
   * way a rejection does (see `reject`'s comment), which is what lets H12's "close, then reopen
   * elsewhere" work as the de facto way to move a shop between communities.
   *
   * The owner's own action, not an admin one — no `CommunityScopeGuard` here. A community admin
   * suspending a shop (#38) is a different action with a different reason to exist.
   */
  async close(actorUserId: string, shopId: string): Promise<MyShopDto> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (shop === null) {
      throw new AppException('NOT_FOUND');
    }

    if (shop.ownerId !== actorUserId) {
      throw new AppException('FORBIDDEN', { message: 'คุณปิดร้านนี้ไม่ได้ เพราะไม่ใช่เจ้าของ' });
    }

    if (shop.closedAt !== null) {
      throw new AppException('CONFLICT', { message: 'ร้านนี้ปิดอยู่แล้ว' });
    }

    if (shop.suspendedAt !== null) {
      // J2's own "ทำไม่ได้" column: a suspended shop closing itself is exactly the escape route
      // that column exists to rule out — a shop under review should not be able to leave the
      // system while the review is unresolved.
      throw new AppException('CONFLICT', { message: 'ร้านที่ถูกระงับอยู่ปิดร้านเองไม่ได้' });
    }

    const blocking = await this.blockingOrders(shopId);
    if (blocking.length > 0) {
      throw new AppException('CONFLICT', {
        message: `ปิดร้านไม่ได้ เพราะยังมีออเดอร์ที่ร้านต้องทำอยู่ ${blocking.length} ใบ`,
        // #39: each blocking order as its own entry, keyed by order id — not a bespoke response
        // shape. L4's error body is locked to three fields (code/message/fieldErrors) precisely
        // so the frontend never grows a second error-handling path; `fieldErrors` already exists
        // for "which of several things caused this", so reusing it here (order id standing in
        // for a form field name) satisfies this ticket's AC ("ระบุได้ว่าใบไหน") without touching
        // that locked shape at all. The frontend can link straight to each order id.
        fieldErrors: Object.fromEntries(blocking.map((order) => [order.id, blockingReasonFor(order)])),
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // §91 (review): everything above again, under the shop's row lock — the same shape
      // `closeForErasure` already had. Checkout takes this row `FOR SHARE`, so an order placed
      // after the check above either committed before this lock (and is seen here) or waits and
      // then finds the shop closed. Before, it could commit in between and leave a closed shop
      // with an open order (I11).
      const current = await this.lockShop(tx, shopId);
      if (current.closedAt !== null) {
        throw new AppException('CONFLICT', { message: 'ร้านนี้ปิดอยู่แล้ว' });
      }
      if (current.suspendedAt !== null) {
        throw new AppException('CONFLICT', { message: 'ร้านที่ถูกระงับอยู่ปิดร้านเองไม่ได้' });
      }
      const stillBlocking = await this.blockingOrders(shopId, tx);
      if (stillBlocking.length > 0) {
        throw new AppException('CONFLICT', {
          message: `ปิดร้านไม่ได้ เพราะยังมีออเดอร์ที่ร้านต้องทำอยู่ ${stillBlocking.length} ใบ`,
          fieldErrors: Object.fromEntries(stillBlocking.map((order) => [order.id, blockingReasonFor(order)])),
        });
      }

      // §109: a waiting profile change goes with the shop — nobody reviews a storefront that no
      // longer sells (§86), and before this it stayed approvable by direct request after the queue
      // had already dropped it.
      const result = await tx.shop.update({
        where: { id: shopId },
        data: { closedAt: this.clock.now(), ...DROPPED_PROFILE_CHANGE },
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'SHOP_CLOSED',
          targetType: 'SHOP',
          targetId: shopId,
          communityId: shop.communityId,
        },
        tx,
      );

      return { result, droppedLogo: current.pendingLogoFileId };
    });

    await this.discardQuietly(updated.droppedLogo);

    return MyShopDto.from(updated.result);
  }

  /**
   * §86 (owner's decision): an admin erasing a banned account closes that owner's open shop on
   * their behalf — the owner cannot sign in to close it themselves (the same door #74 exists for),
   * and K15 would otherwise refuse the erasure forever. Only when closing is allowed by the same I11
   * rule the owner faces (`blockingOrders`, same 409 shape); J2's "a suspended shop cannot close
   * itself" is not applied, because that rule stops an owner escaping review, and this is the admin
   * ending the account. Under the shop's row lock, so no order slips in between the check and the
   * close. Returns without doing anything when the owner has no open shop.
   */
  async closeForErasure(actorUserId: string, ownerId: string, reason: string): Promise<void> {
    const shop = await this.prisma.shop.findFirst({
      where: { ownerId, closedAt: null },
      select: { id: true },
    });
    if (shop === null) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockShop(tx, shop.id);
      if (current.closedAt !== null) {
        return;
      }

      const blocking = await this.blockingOrders(shop.id, tx);
      if (blocking.length > 0) {
        throw new AppException('CONFLICT', {
          message: `ลบบัญชีนี้ไม่ได้ เพราะร้านของบัญชีนี้ยังมีออเดอร์ที่ต้องจัดการอยู่ ${blocking.length} ใบ`,
          fieldErrors: Object.fromEntries(
            blocking.map((order) => [order.id, blockingReasonFor(order)]),
          ),
        });
      }

      await tx.shop.update({ where: { id: shop.id }, data: { closedAt: this.clock.now() } });
      await this.audit.record(
        {
          actorUserId,
          action: 'SHOP_CLOSED',
          targetType: 'SHOP',
          targetId: shop.id,
          communityId: current.communityId,
          reason,
        },
        tx,
      );
    });
  }

  /**
   * The orders that would block closing this shop (#39, I11 · J1 — "ปิดร้านไม่ได้ถ้ามีงานค้าง").
   *
   * The rule is not "not yet terminal" — it is "still the *shop's own* turn", which is why this
   * is a filter of `OrderFreezeService.NON_TERMINAL_STATUSES` rather than that list verbatim: the
   * ticket's own table singles out `SHIPPED` ("ส่งของแล้ว รอผู้ซื้อกดรับ") as the one non-terminal
   * status that does **not** block, because from there the buyer is the one holding things up
   * (D5 has no auto-close, so a buyer who never clicks "received" cannot be allowed to trap the
   * shop in the system forever). Filtering rather than a second hand-written list means the two
   * can never quietly drift apart if a future ticket changes what counts as non-terminal.
   *
   * A frozen order (`frozenAt`, I6) blocks regardless of its underlying status — including
   * `SHIPPED`, which is otherwise the one status that doesn't — because a freeze means an admin
   * still owes this order a decision, which is unfinished shop business by definition.
   */
  private async blockingOrders(
    shopId: string,
    client: Pick<Prisma.TransactionClient, 'order'> = this.prisma,
  ): Promise<{ id: string; status: OrderStatus; frozenAt: Date | null }[]> {
    return client.order.findMany({
      where: {
        shopId,
        OR: [{ frozenAt: { not: null } }, { status: { in: [...SHOP_CLOSE_BLOCKING_STATUSES] } }],
      },
      select: { id: true, status: true, frozenAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * The public list (invariant 1): no session, optionally filtered by `communityId` (L8 — omit
   * it and every community's shops come back), and only shops that are live — `LIVE_SHOP_FILTER`
   * is the one place that means (invariant 6's third layer, #38). A shop still `PENDING` or
   * `REJECTED` has never been shown to anyone but its own owner; a closed one is the soft-deleted
   * state spec 4/12 describes; a suspended one hides here but its direct link still answers
   * (`findPublic` below).
   */
  async list(
    communityId: string | undefined,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ShopDto>> {
    const rows = await this.prisma.shop.findMany({
      where: {
        ...keysetAfter(cursor, LIST_NAME),
        ...LIVE_SHOP_FILTER,
        ...(communityId !== undefined ? { communityId } : {}),
      },
      orderBy: newestFirst(),
      take: limit + 1,
      include: { 
        owner: { select: { disputeLostCount: true, bannedAt: true } }, 
        community: { select: { name: true } },
        _count: { select: { products: { where: { moderationStatus: 'APPROVED' } } } }
      },
    });

    const page = toPage(rows, limit, LIST_NAME);
    const statsByShopId = await this.reviewStatsFor(page.items);

    return {
      ...page,
      items: page.items.map((row) => ShopDto.from(row, statsByShopId.get(row.id) ?? EMPTY_REVIEW_STATS)),
    };
  }

  /**
   * The public single-shop view. Gated by `approvalStatus` only, **not** `closedAt`:
   *
   *   - Never approved (PENDING/REJECTED) → `NOT_FOUND`, identical to an id that never existed.
   *     A shop nobody has approved yet is not a real listing for a stranger to find by guessing
   *     an id, and there is no privilege boundary here to protect by making the two
   *     distinguishable (contrast `CommunityScopeGuard`, where that distinction matters because
   *     an authorization decision sits behind it).
   *   - Approved and then closed → still answers `200` (#37). An old order's page points at this
   *     id, and spec 4/12 requires that link to keep working rather than 404 the moment the shop
   *     closes — `ShopDto.closedAt` is what lets the frontend tell the two apart.
   *
   * `list()` above is the one that filters `closedAt: null`; a closed shop simply never appears
   * there, which is a different question from what a direct link to it does.
   *
   * A suspended shop (#38) follows the identical rule: gated by `approvalStatus` alone, so its
   * direct link stays open too — `ShopDto.suspendedAt` is what lets the frontend show the
   * "ร้านนี้ถูกระงับชั่วคราว" badge invariant 6 asks for, the same way `closedAt` does above.
   */
  async findPublic(id: string): Promise<ShopDto> {
    const shop = await this.prisma.shop.findFirst({
      where: { id, approvalStatus: 'APPROVED' },
      include: { 
        owner: { select: { disputeLostCount: true, bannedAt: true } }, 
        community: { select: { name: true } },
        _count: { select: { products: { where: { moderationStatus: 'APPROVED' } } } }
      },
    });
    if (shop === null) {
      throw new AppException('NOT_FOUND');
    }

    const statsByShopId = await this.reviewStatsFor([shop]);

    return ShopDto.from(shop, statsByShopId.get(shop.id) ?? EMPTY_REVIEW_STATS);
  }

  /**
   * #60 (K10): one grouped aggregate for however many shops a caller just fetched, rather than one
   * query per shop — `list()` can return up to 50 rows (I17), and a per-row `review.aggregate`
   * call would be the N+1 this avoids. Excludes soft-deleted reviews (L3), the same filter the
   * public review list itself applies, so a shop's rating cannot be dragged down by something a
   * community admin already removed for breaking the rules.
   *
   * §85: grouped by the shop's *owner*, not the shop row — closing a shop and opening a new one
   * (H12) must not wash away every 1-star review, the same reasoning I12 gives for keeping
   * `disputeLostCount` on the person. `ReviewService.listForShop` lists the same set. Raw SQL
   * because Prisma's `groupBy` cannot group on a relation's column; parameterized as CLAUDE.md
   * requires.
   */
  async reviewStatsFor(shops: readonly { id: string; ownerId: string }[]): Promise<Map<string, ReviewStats>> {
    if (shops.length === 0) {
      return new Map();
    }

    const ownerIds = [...new Set(shops.map((shop) => shop.ownerId))];
    const grouped = await this.prisma.$queryRaw<{ owner_id: string; average: number | null; count: bigint }[]>`
      SELECT s.owner_id, AVG(r.rating)::float8 AS average, COUNT(*) AS count
      FROM review r
      JOIN shop s ON s.id = r.shop_id
      WHERE r.deleted_at IS NULL AND s.owner_id IN (${Prisma.join(ownerIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY s.owner_id
    `;
    const byOwner = new Map(
      grouped.map((row) => [row.owner_id, { averageRating: row.average === null ? null : Math.round(row.average * 10) / 10, reviewCount: Number(row.count) }]),
    );

    return new Map(shops.map((shop) => [shop.id, byOwner.get(shop.ownerId) ?? EMPTY_REVIEW_STATS]));
  }

  async getFollowStatus(shopId: string, userId: string | null): Promise<{ followerCount: number; isFollowing: boolean }> {
    const followerCount = await this.prisma.shopFollow.count({ where: { shopId } });
    let isFollowing = false;
    if (userId !== null) {
      const follow = await this.prisma.shopFollow.findUnique({
        where: { userId_shopId: { userId, shopId } },
      });
      isFollowing = follow !== null;
    }
    return { followerCount, isFollowing };
  }

  async followShop(userId: string, shopId: string): Promise<void> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (shop === null) {
      throw new AppException('NOT_FOUND');
    }
    try {
      await this.prisma.shopFollow.create({
        data: { userId, shopId, id: newId() },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }

  async unfollowShop(userId: string, shopId: string): Promise<void> {
    try {
      await this.prisma.shopFollow.delete({
        where: { userId_shopId: { userId, shopId } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        // Not following, ignore
      } else {
        throw e;
      }
    }
  }
}

/**
 * Whether Prisma is reporting a unique-constraint violation (P2002).
 *
 * A fourth copy of the same three-line check `AuthService`, `GoogleAuthService` and
 * `CommunityAdminService` each already carry. Consolidating all four is a real cleanup, but it is
 * not this ticket's diff to widen — flagged in `docs/PROGRESS.md` instead.
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}




