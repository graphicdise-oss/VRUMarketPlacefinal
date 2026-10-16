import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { isUniqueViolation } from '../common/errors/prisma-errors.js';
import { newId } from '../common/id.js';
import { lockLiveAccount } from '../common/live-account-lock.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { refuseOwnCase } from '../community/community-admin-scope.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../files/file-storage.service.js';
import { NotificationService } from '../notification/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, Clock } from '../time/clock.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewDto } from './dto/review.dto.js';
import { EDIT_WINDOW_DAYS, MAX_REVIEW_IMAGES } from './review-policy.js';

const LIST_NAME = 'shopReviews';

const REVIEW_INCLUDE = {
  images: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ReviewInclude;

const EDIT_CLOSED_MESSAGE = 'รีวิวนี้ถูกลบไปแล้ว หรือพ้นช่วงที่แก้ไขได้แล้ว';

/** §111: text that trims to nothing is no text — the same `null` a review written without any gets. */
function reviewText(dto: CreateReviewDto): string | null {
  return dto.text === undefined || dto.text === '' ? null : dto.text;
}

/**
 * `Review` (#60, F2/K10/I18/I18c/L3): one review per order, written only after the buyer marks it
 * received (#59's `completedAt`), editable for `EDIT_WINDOW_DAYS` from the moment it was written,
 * never deletable by its own author or by the shop it's about — only a community admin can remove
 * one, and only with a reason.
 */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
    private readonly clock: Clock,
  ) {}

  /**
   * F2: gated on `order.completedAt !== null`, not on any dispute state (I18c — a review is an
   * opinion, a dispute is a fact-finding process, and this ticket keeps the two unrelated on
   * purpose). I18b: no upper bound on how late this can be written — F2's own gate (must have
   * received) is the only limit the AC asks for.
   */
  async create(buyerId: string, orderId: string, dto: CreateReviewDto): Promise<ReviewDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.completedAt === null) {
      throw new AppException('CONFLICT', { message: 'เขียนรีวิวได้หลังกดรับของแล้วเท่านั้น' });
    }

    const now = this.clock.now();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // §96: the text is the buyer's own words, overwritten by their erasure — so written under
        // the account's lock like every other such write (§84), or it can land a moment after the
        // erasure and stay, public, for good.
        await lockLiveAccount(tx, buyerId);
        return tx.review.create({
          data: {
            id: newId(),
            orderId: order.id,
            buyerId,
            shopId: order.shopId,
            rating: dto.rating,
            text: reviewText(dto),
            createdAt: now,
            updatedAt: now,
          },
          include: REVIEW_INCLUDE,
        });
      });

      return ReviewDto.from(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The check this ticket's own AC asks for ("เขียนซ้ำออเดอร์เดิม → ถูกปฏิเสธ") loses its race
        // to `review_order_id_key` here — mapped to the same CONFLICT a pre-check would give.
        throw new AppException('CONFLICT', { message: 'ออเดอร์นี้มีรีวิวอยู่แล้ว เขียนซ้ำไม่ได้' });
      }
      throw error;
    }
  }

  /**
   * I18: editable only within `EDIT_WINDOW_DAYS` of `Review.createdAt`, which this never moves —
   * see that column's own schema comment for why the deadline must not restart on every edit.
   *
   * §85: the write itself carries both conditions (not deleted, still inside the window), so an
   * edit that lands a moment after a community admin deleted the review is refused instead of
   * rewriting the very text the deletion reason refers to.
   */
  async update(buyerId: string, orderId: string, dto: CreateReviewDto): Promise<ReviewDto> {
    const review = await this.requireOwnEditableReview(buyerId, orderId);

    const now = this.clock.now();
    const written = await this.prisma.$transaction(async (tx) => {
      // §96: under the account's lock, as `create` explains.
      await lockLiveAccount(tx, buyerId);
      return tx.review.updateMany({
        where: { id: review.id, deletedAt: null, createdAt: { gte: addDays(now, -EDIT_WINDOW_DAYS) } },
        data: { rating: dto.rating, text: reviewText(dto), updatedAt: now },
      });
    });
    if (written.count === 0) {
      throw new AppException('CONFLICT', { message: EDIT_CLOSED_MESSAGE });
    }

    const updated = await this.prisma.review.findUniqueOrThrow({ where: { id: review.id }, include: REVIEW_INCLUDE });

    return ReviewDto.from(updated);
  }

  /**
   * K10: up to `MAX_REVIEW_IMAGES`. Gated by the same edit window as `update` — a photo is exactly
   * as much a change to the review's content as its rating or text, so there is no reason for it
   * to stay open longer.
   *
   * §85: the cap is re-counted under a lock on the review row, inside the transaction that adds
   * the photo — two uploads sent together at four photos used to both pass a count read outside it
   * and end at six. A photo that loses (cap reached, review deleted, window closed) is discarded
   * from disk rather than left behind, the same "store, then discard on failure" §83 uses for chat.
   */
  /**
   * The buyer's own review, still editable and with room for another photo. Also asked by the upload
   * route before the file is read (§100, `@AcceptsUpload`).
   */
  async requireImageSlot(buyerId: string, orderId: string): Promise<{ id: string }> {
    const review = await this.requireOwnEditableReview(buyerId, orderId);
    if (review.images.length >= MAX_REVIEW_IMAGES) {
      throw new AppException('CONFLICT', { message: `รูปรีวิวได้สูงสุด ${MAX_REVIEW_IMAGES} รูป` });
    }
    return review;
  }

  async addImage(buyerId: string, orderId: string, upload: UploadedTempFile): Promise<ReviewDto> {
    const review = await this.requireImageSlot(buyerId, orderId);

    const stored = await this.files.storeImage(upload);
    const now = this.clock.now();
    try {
      await this.prisma.$transaction(async (tx) => {
        // §96: the account first (user → review): erasure collects this buyer's review photos to
        // delete, and a photo attached after it committed was never deleted and stayed public.
        await lockLiveAccount(tx, buyerId);
        await lockEditableReview(tx, review.id, now);
        const imageCount = await tx.reviewImage.count({ where: { reviewId: review.id } });
        if (imageCount >= MAX_REVIEW_IMAGES) {
          throw new AppException('CONFLICT', { message: `รูปรีวิวได้สูงสุด ${MAX_REVIEW_IMAGES} รูป` });
        }

        await tx.reviewImage.create({ data: { id: newId(), reviewId: review.id, fileId: stored.id, createdAt: now } });
        await tx.review.update({ where: { id: review.id }, data: { updatedAt: now } });
      });
    } catch (error) {
      await this.files.discardUnattached(stored.id);
      throw error;
    }

    const updated = await this.prisma.review.findUniqueOrThrow({ where: { id: review.id }, include: REVIEW_INCLUDE });

    return ReviewDto.from(updated);
  }

  /**
   * §111 (the owner's decision): the buyer takes back a photo of their own review, inside the same
   * edit window that lets them add one — a photo uploaded by mistake (a face, an address label) used
   * to stay public for good. The file is deleted at once, like a removed product photo (§109): a
   * review photo is the buyer's opinion, not evidence anything else keeps.
   */
  async removeImage(buyerId: string, orderId: string, imageId: string): Promise<ReviewDto> {
    const review = await this.requireOwnEditableReview(buyerId, orderId);

    const now = this.clock.now();
    const removed = await this.prisma.$transaction(async (tx) => {
      // The same locks, in the same order, as `addImage`: the account (user → review), then the review.
      await lockLiveAccount(tx, buyerId);
      await lockEditableReview(tx, review.id, now);
      const image = await tx.reviewImage.findFirst({ where: { id: imageId, reviewId: review.id }, select: { id: true, fileId: true } });
      if (image === null) {
        throw new AppException('NOT_FOUND');
      }
      await tx.reviewImage.delete({ where: { id: image.id } });
      await tx.review.update({ where: { id: review.id }, data: { updatedAt: now } });

      return image;
    });
    await this.files.discardUnattached(removed.fileId).catch(() => {
      this.logger.warn(`Could not delete removed review photo file ${removed.fileId}; remove it by hand`);
    });

    const updated = await this.prisma.review.findUniqueOrThrow({ where: { id: review.id }, include: REVIEW_INCLUDE });

    return ReviewDto.from(updated);
  }

  /**
   * The bytes of one review photo — public, no ownership check, same as a product photo. §85: not
   * once the review is deleted (L3) — a photo removed for breaking the rules must not stay
   * reachable by its direct link.
   */
  async readImage(reviewId: string, imageId: string): Promise<ReadImage> {
    const image = await this.prisma.reviewImage.findFirst({ where: { id: imageId, reviewId, review: { deletedAt: null } } });
    if (image === null) {
      throw new AppException('NOT_FOUND');
    }

    const file = await this.files.readImage(image.fileId);
    if (file === null) {
      throw new AppException('NOT_FOUND');
    }

    return file;
  }

  /**
   * Invariant 1 / this ticket's own AC: no session required. Excludes soft-deleted rows (L3) —
   * the one filter every public read of `Review` applies, never the buyer/shop-facing views on
   * `OrderDto`, which show a deleted review's own fate to the person it happened to.
   *
   * §85: every review of every shop this shop's *owner* has run, not only this shop row's — the
   * rating follows the person across a close-and-reopen the same way `disputeLostCount` does
   * (I12), and this list has to match the `averageRating`/`reviewCount` `ShopService` shows.
   */
  async listForShop(shopId: string, limit: number, cursor: string | undefined): Promise<Page<ReviewDto>> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { ownerId: true } });
    if (shop === null) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.review.findMany({
      where: { shop: { ownerId: shop.ownerId }, deletedAt: null, ...keysetAfter(cursor, LIST_NAME) },
      orderBy: newestFirst(),
      take: limit + 1,
      include: REVIEW_INCLUDE,
    });

    const page = toPage(rows, limit, LIST_NAME);

    return { ...page, items: page.items.map((row) => ReviewDto.from(row)) };
  }

  /**
   * L3: a community admin's sixth power — `CommunityScopeGuard` (through `ReviewIdScopeResolver`)
   * has already confirmed the caller administers the community this review's shop belongs to (or
   * is super admin) by the time this runs. Soft delete only (I3-style reasoning: a rating average
   * that could retroactively lose evidence the moment a row disappears is not trustworthy), and
   * always logged — `REVIEW_DELETED` is in `ACTIONS_REQUIRING_REASON`, so a missing reason is
   * rejected before this method is ever called (the DTO itself enforces it).
   */
  async remove(actorUserId: string, reviewId: string, reason: string): Promise<ReviewDto> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId }, include: { shop: { select: { ownerId: true, communityId: true } } } });
    if (review === null) {
      throw new AppException('NOT_FOUND');
    }
    // N28 (§85): not an admin who owns the shop this review is about, nor one who wrote it.
    refuseOwnCase(actorUserId, { buyerId: review.buyerId, shopOwnerId: review.shop.ownerId });
    if (review.deletedAt !== null) {
      throw new AppException('CONFLICT', { message: 'รีวิวนี้ถูกลบไปแล้ว' });
    }

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      // §85: the "not deleted yet" check rides on the write itself — two admins deleting at once
      // used to both succeed, the second overwriting the first's reason with a second audit entry.
      const claimed = await tx.review.updateMany({
        where: { id: reviewId, deletedAt: null },
        data: { deletedAt: now, deletedByUserId: actorUserId, deletionReason: reason, updatedAt: now },
      });
      if (claimed.count === 0) {
        throw new AppException('CONFLICT', { message: 'รีวิวนี้ถูกลบไปแล้ว' });
      }

      await this.audit.record(
        { actorUserId, action: 'REVIEW_DELETED', targetType: 'REVIEW', targetId: reviewId, reason, communityId: review.shop.communityId },
        tx,
      );
    });

    // §111 (the owner's decision): the author used to learn of it only by opening the order again.
    await this.notifications.notify({
      userId: review.buyerId,
      type: 'REVIEW_REMOVED',
      message: `รีวิวของคุณถูกแอดมินลบ เหตุผล: ${reason}`,
      targetType: 'ORDER',
      targetId: review.orderId,
    });

    const updated = await this.prisma.review.findUniqueOrThrow({ where: { id: reviewId }, include: REVIEW_INCLUDE });

    return ReviewDto.from(updated);
  }

  /** Shared by `update`, `addImage` and `removeImage`: must be the caller's own review, not deleted, and still inside the edit window. */
  private async requireOwnEditableReview(
    buyerId: string,
    orderId: string,
  ): Promise<{ id: string; deletedAt: Date | null; createdAt: Date; images: { id: string; createdAt: Date }[] }> {
    const review = await this.prisma.review.findFirst({ where: { orderId, buyerId }, include: REVIEW_INCLUDE });
    if (review === null) {
      throw new AppException('NOT_FOUND');
    }
    if (review.deletedAt !== null) {
      throw new AppException('CONFLICT', { message: 'รีวิวนี้ถูกลบไปแล้ว แก้ไขไม่ได้' });
    }
    if (this.clock.now() > addDays(review.createdAt, EDIT_WINDOW_DAYS)) {
      throw new AppException('CONFLICT', { message: `แก้ไขได้ภายใน ${EDIT_WINDOW_DAYS} วันนับจากวันที่เขียนรีวิวเท่านั้น` });
    }

    return review;
  }
}

/**
 * §85: the review row locked, then re-read — still not deleted and still inside the edit window
 * under the lock, where the check before the transaction may already be stale.
 */
async function lockEditableReview(tx: Prisma.TransactionClient, reviewId: string, now: Date): Promise<void> {
  await tx.$queryRaw`SELECT id FROM review WHERE id = ${reviewId}::uuid FOR UPDATE`;
  const locked = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, select: { deletedAt: true, createdAt: true } });
  if (locked.deletedAt !== null || now > addDays(locked.createdAt, EDIT_WINDOW_DAYS)) {
    throw new AppException('CONFLICT', { message: EDIT_CLOSED_MESSAGE });
  }
}
