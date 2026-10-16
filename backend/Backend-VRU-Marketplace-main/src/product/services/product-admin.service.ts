import { Injectable } from '@nestjs/common';
import { Prisma, ProductModerationStatus, UserRole } from '@prisma/client';
import { AuditLogService } from '../../audit/audit-log.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { keysetAfter, newestFirst } from '../../common/pagination/keyset.js';
import { Page, toPage } from '../../common/pagination/page.js';
import { communityFilterFor, inCommunities } from '../../community/community-admin-scope.js';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { ProductDto } from '../dto/product.dto.js';
import { RejectProductDto } from '../dto/reject-product.dto.js';
import { OrderFreezeService, CancelledForProhibitedProduct } from "../../order/services/order-freeze.service.js";

/** What every owner-facing read query includes — the shape `ProductDto.from` needs. */
const PRODUCT_INCLUDE = {
  variants: { where: { deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  images: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProductInclude;



/** The name the "pending review" cursor carries — a different list from the public one (#33's own trick). */
const PENDING_LIST_NAME = 'productsPending';

/**
 * §109 (owner's decision): a reject may land on a live product too — a reviewer's mistake or a
 * buyer's report found after approval would otherwise need the whole shop suspended to stop it.
 */
const REJECTABLE_STATUSES: readonly ProductModerationStatus[] = ['PENDING', 'APPROVED'];

/** An approval only ever lands on a product waiting for one. */
const APPROVABLE_STATUSES: readonly ProductModerationStatus[] = ['PENDING'];

/**
 * How many matching ids one search page may scan (§79).
 *
 * The match query used to be unbounded: every id matching `q` came back into Node and went out
 * again as `IN (...)`, so a one-character query on a large catalogue round-tripped most of the
 * table on an anonymous, un-rate-limited request, and past ~65k matches it exceeded PostgreSQL's
 * bind-parameter ceiling and answered 500. This cap bounds both. It sits far above `MAX_PAGE_SIZE`
 * so an ordinary page fills from a single batch; a query broad enough to scan a whole batch
 * without filling one simply pages on — see the cursor handling in `search` for how that stays
 * correct rather than silently truncating.
 *
 * Exported so the test that covers that paging-on branch cannot drift from the real number.
 */
export const SEARCH_MATCH_SCAN_LIMIT = 500;

/**
 * `Product` + `ProductVariant` (#41): a shop owner adding what they sell, and attaching photos to
 * it through #36's shared file-storage helper. Everything owner-facing here acts on the caller's
 * own shop, resolved through `ShopService.findOwnShopRow` — the same "1 คน = 1 ร้าน" reasoning
 * `PaymentChannelService` already uses. `publish`/`unpublish`, `list`, and `findPublic` are #42's
 * addition: the shop's own visibility toggle, and the only place a stranger ever sees a product.
 * `approve`/`reject`/`pending` are #43's: the two-tier guard's (#32) next real user after `Shop`,
 * through `ProductIdScopeResolver`.
 *
 * `updateDetails`/`addVariant`/`updateVariant`/`removeVariant`, plus the reset added to `addImage`/
 * `removeImage` below, are #44's: invariant 6's two-group edit split (A3/I13). Every one of them
 * shares `resetToPending()` for "goes back to PENDING" — never a second copy of those
 * fields — and `requireOwnedProduct` for "must be the caller's own shop, which must not be
 * suspended" (J2/#38), the same guard every other owner-facing method here already uses.
 *
 * `search` is #45's: Thai-language trigram matching (N5) feeding into the exact same visibility
 * composition `list` uses, never a second copy of it.
 */
@Injectable()
export class ProductAdminService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
    private readonly orderFreeze: OrderFreezeService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Approves a PENDING product (#43). Guard-checked entirely by `CommunityScopeGuard` (#32) via
   * `ProductIdScopeResolver` before this runs — this only has to enforce what the guard cannot
   * know: the product is still awaiting review, and the approver is not the product's own shop's
   * owner (N28, extended from `Shop`'s approve/reject and suspend/unsuspend — the same conflict
   * of interest, on a different resource: a person able to fast-track their own listing is
   * exactly the person with the most incentive to).
   *
   * Clears any leftover `rejectionCategory`/`rejectionReason` from an earlier cycle — approving a
   * product should never leave a stale rejection reason sitting on it for a caller to read.
   */
  async approve(actorUserId: string, productId: string, reviewRevision: number): Promise<ProductDto> {
    const pending = await this.requireDecidable(productId, actorUserId, APPROVABLE_STATUSES);

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      // Checked twice, the same shape `OrderService.setShippingFee` uses: cheaply above for a
      // clear error, then again as the condition on the write itself (§79). Without the second
      // check two admins deciding the same product at once both succeed — and an approve racing a
      // PROHIBITED reject leaves the product APPROVED and publicly listed *after*
      // `handleProhibitedProduct` has already cancelled its unpaid orders and frozen the paid ones.
      // §91: and only the revision the reviewer's screen showed — see `refuseUndecided`.
      const changed = await tx.product.updateMany({
        where: { id: productId, moderationStatus: 'PENDING', deletedAt: null, reviewRevision },
        data: {
          moderationStatus: 'APPROVED',
          rejectionCategory: null,
          rejectionReason: null,
          updatedAt: now,
        },
      });
      if (changed.count === 0) {
        await refuseUndecided(tx, productId, APPROVABLE_STATUSES);
      }
      // §109: every photo the reviewer just saw is now public.
      await tx.productImage.updateMany({ where: { productId, approvedAt: null }, data: { approvedAt: now } });

      const result = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: PRODUCT_INCLUDE,
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'PRODUCT_APPROVED',
          targetType: 'PRODUCT',
          targetId: productId,
          communityId: pending.shop.communityId,
        },
        tx,
      );

      return result;
    });

    await this.notifyOwner(updated.shopId, productId, 'PRODUCT_APPROVED', 'สินค้าของคุณได้รับการอนุมัติแล้ว');

    return ProductDto.from(updated);
  }

  /**
   * Rejects a PENDING product with a category (H4) topics 7 and 10 branch on, plus a reason the
   * seller reads. Same guard and self-approval rule as `approve`.
   *
   * ⚠️ **#61 is the ticket that actually reads `rejectionCategory` and acts on it** — cancelling
   * an unpaid order and refunding stock for `PROHIBITED`, freezing a paid one, through
   * `OrderFreezeService.handleProhibitedProduct` in the same transaction. `NEEDS_FIX` never
   * reaches that call at all: an order in flight is unaffected by it (H4), so this method simply
   * does nothing more for that category.
   */
  async reject(actorUserId: string, productId: string, dto: RejectProductDto): Promise<ProductDto> {
    const pending = await this.requireDecidable(productId, actorUserId, REJECTABLE_STATUSES);

    const now = this.clock.now();
    let cancelledOrders: CancelledForProhibitedProduct[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      // Same compare-and-swap as `approve` — see its comment. It matters more here: everything
      // `handleProhibitedProduct` does below is irreversible from this method's point of view.
      const changed = await tx.product.updateMany({
        where: { id: productId, moderationStatus: { in: [...REJECTABLE_STATUSES] }, deletedAt: null, reviewRevision: dto.reviewRevision },
        data: {
          moderationStatus: 'REJECTED',
          rejectionCategory: dto.category,
          rejectionReason: dto.reason,
          updatedAt: now,
        },
      });
      if (changed.count === 0) {
        await refuseUndecided(tx, productId, REJECTABLE_STATUSES);
      }

      const result = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: PRODUCT_INCLUDE,
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'PRODUCT_REJECTED',
          targetType: 'PRODUCT',
          targetId: productId,
          communityId: pending.shop.communityId,
          // The category rides along in the free-text reason: audit_log deliberately has no
          // structured metadata column (see that model's own comment on why), and this is
          // historical record-keeping — the real, queryable value #61 acts on lives on
          // Product.rejectionCategory itself, set above in the same transaction.
          reason: `[${dto.category}] ${dto.reason}`,
        },
        tx,
      );

      if (dto.category === 'PROHIBITED') {
        cancelledOrders = await this.orderFreeze.handleProhibitedProduct(tx, actorUserId, productId, now);
      }

      return result;
    });

    // Code review (2026-09-22, §78): the seller has no page this message could have pointed to
    // (there was no `GET /products/mine` — see that route, added in the same fix — and even the
    // owner's own `GET /products/:id` 404s once a product leaves APPROVED). Put the category and
    // reason directly in the message text instead of pointing anywhere, same shape as topic 4's
    // `SHOP_REJECTED` (§77).
    await this.notifyOwner(
      updated.shopId,
      productId,
      'PRODUCT_REJECTED',
      `สินค้าของคุณไม่ผ่านการอนุมัติ (${dto.category}): ${dto.reason}`,
    );
    // §87 (owner's decision): in-app only, like the other cancellations §85 added a notice for.
    for (const { orderId, buyerId } of cancelledOrders) {
      await this.notifications.notify({
        userId: buyerId,
        type: 'ORDER_CANCELLED_PROHIBITED',
        message: 'ออเดอร์ของคุณถูกยกเลิก เพราะสินค้าชิ้นหนึ่งในออเดอร์ถูกตัดสินว่าเป็นของต้องห้าม',
        targetType: 'ORDER',
        targetId: orderId,
      });
    }

    return ProductDto.from(updated);
  }

  /** #69: in-app only — shared by `approve`/`reject`. */
  private async notifyOwner(shopId: string, productId: string, type: 'PRODUCT_APPROVED' | 'PRODUCT_REJECTED', message: string): Promise<void> {
    const shop = await this.prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { ownerId: true } });
    await this.notifications.notify({ userId: shop.ownerId, type, message, targetType: 'PRODUCT', targetId: productId });
  }

  /**
   * Pending products the caller may review — every one, for a super admin, or only those whose
   * shop is in a community the caller administers. Not gated by `CommunityScopeGuard`: that guard
   * checks one target's community against the caller, and this route has no single target — same
   * shape as `ShopService.pending`, sharing its `communityFilterFor` helper.
   */
  async pending(
    actorUserId: string,
    role: UserRole,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ProductDto>> {
    const communityFilter = await communityFilterFor(this.prisma, actorUserId, role);
    if (communityFilter === 'none') {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.product.findMany({
      where: {
        ...keysetAfter(cursor, PENDING_LIST_NAME),
        moderationStatus: 'PENDING',
        // §79: every other surface (`list`, `search`, `findPublic`, `listMine`) already excludes a
        // soft-deleted product; this queue was the one that did not, so a product deleted while
        // pending sat in a reviewer's queue forever and could still be approved — notifying its
        // owner that something they had deleted went live.
        deletedAt: null,
        shop: inCommunities(communityFilter),
      },
      orderBy: newestFirst(),
      take: limit + 1,
      include: PRODUCT_INCLUDE,
    });

    const page = toPage(rows, limit, PENDING_LIST_NAME);

    return { ...page, items: page.items.map((row) => ProductDto.from(row)) };
  }

  /**
   * Shared by `approve` and `reject`: the checks neither the guard nor the route can express.
   * `decidable` is what the decision may still act on — PENDING for approve, and PENDING or APPROVED
   * for reject (§109: taking down a live product).
   */
  private async requireDecidable(
    productId: string,
    actorUserId: string,
    decidable: readonly ProductModerationStatus[],
  ): Promise<{
    id: string;
    moderationStatus: ProductModerationStatus;
    shop: { ownerId: string; communityId: string };
  }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, moderationStatus: true, shop: { select: { ownerId: true, communityId: true } } },
    });
    // CommunityScopeGuard already confirmed the product exists (its resolver would have answered
    // 403 otherwise), so reaching null here means it has since been soft-deleted (§79 — a deleted
    // product is not a reviewable one) or hard-deleted in the instant between.
    if (product === null) {
      throw new AppException('NOT_FOUND');
    }

    if (product.shop.ownerId === actorUserId) {
      throw new AppException('FORBIDDEN', { message: 'คุณอนุมัติหรือปฏิเสธสินค้าของร้านตัวเองไม่ได้' });
    }

    if (!decidable.includes(product.moderationStatus)) {
      throw new AppException('CONFLICT', { message: 'สินค้านี้ถูกตัดสินไปแล้ว' });
    }

    return product;
  }

  /**
   * §109: an admin's look at one product whatever its status — what a reviewer taking down a live
   * product reads before deciding, with the `reviewRevision` the decision must carry. Guard-checked
   * by the controller (`ProductIdScopeResolver`), the same shape as `GET /shops/:id/admin`.
   */
  async findAdmin(productId: string): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, include: PRODUCT_INCLUDE });
    if (product === null) {
      throw new AppException('NOT_FOUND');
    }

    return ProductDto.from(product);
  }
}



/**
 * §110 (owner's decision, as Shopee/Lazada do): one product's live options each have their own name
 * — two called "สีแดง" at different prices leave a buyer guessing which they are paying for. Compared
 * trimmed and case-folded (the DTO already trims; Latin names like "Red"/"red" read as the same).
 * Other products may reuse a name, and a deleted option's name is free again. Rows that already
 * repeat a name from before §110 are left as they are.
 */


/**
 * §91: why a decision's conditional write matched nothing. A product no longer in a status the
 * decision acts on was decided by someone else (CONFLICT, as before); one still in it was edited
 * after the reviewer opened it (STALE_VIEW) — their screen shows wording that is not there any more.
 */
async function refuseUndecided(tx: Prisma.TransactionClient, productId: string, decidable: readonly ProductModerationStatus[]): Promise<never> {
  const current = await tx.product.findUnique({ where: { id: productId }, select: { moderationStatus: true, deletedAt: true } });
  if (current !== null && current.deletedAt === null && decidable.includes(current.moderationStatus)) {
    throw new AppException('STALE_VIEW', {
      message: 'สินค้านี้ถูกแก้ไขหลังจากที่คุณเปิดดู กรุณาโหลดใหม่แล้วตรวจฉบับล่าสุดก่อนตัดสิน',
    });
  }
  throw new AppException('CONFLICT', { message: 'สินค้านี้ถูกตัดสินไปแล้ว' });
}

/** §103: who is asking for a product photo, when a session came with the request. */
export interface ImageViewer {
  readonly id: string;
  readonly role: UserRole;
}


