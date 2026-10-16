import { Injectable } from '@nestjs/common';
import { Dispute, Prisma } from '@prisma/client';
import { communityAdminsToNotify } from '../../community/community-admin-scope.js';
import { AppException } from '../../common/errors/app-exception.js';
import { newId } from '../../common/id.js';
import { isUniqueViolation } from '../../common/errors/prisma-errors.js';
import { FileStorageService, ReadImage, StoredImage, UploadedTempFile } from '../../files/file-storage.service.js';
import { NotificationService } from '../../notification/notification.service.js';
import { lockLiveAccount } from '../../common/live-account-lock.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { canOpenDisputeNow } from '../common/dispute-deadline.js';
import { MAX_EVIDENCE_FILES } from '../common/dispute-policy.js';
import { DisputeDto } from '../dto/dispute.dto.js';
import { OpenDisputeDto } from '../dto/open-dispute.dto.js';
import { RespondDisputeDto } from '../dto/respond-dispute.dto.js';
import { ownedByShopOwner } from "../../order/services/order.service.js";

const DISPUTE_INCLUDE = {
  evidence: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.DisputeInclude;

/**
 * `Dispute` + `DisputeEvidence` (#63/#64): opening, responding, ruling (K12), a super admin's
 * override (I9b), and the one break-glass door into an order's PII while its dispute is open
 * (I5). K13's "one OPEN dispute at a time" is enforced twice — a friendly pre-check here, and the
 * partial unique index (`dispute_one_open_per_order_key`) as the real guarantee under a race.
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * D5b/I6: `Order.status` is never touched here — only a `Dispute` row is created, exactly what
   * this ticket's own AC calls out as the one test that "ขาดไม่ได้". Evidence is mandatory (I17):
   * a request with no files never reaches the database at all.
   */
  async open(buyerId: string, orderId: string, dto: OpenDisputeDto, uploads: readonly UploadedTempFile[]): Promise<DisputeDto> {
    if (uploads.length === 0) {
      throw new AppException('VALIDATION_FAILED', { message: 'ต้องแนบหลักฐานอย่างน้อยหนึ่งไฟล์' });
    }
    if (uploads.length > MAX_EVIDENCE_FILES) {
      throw new AppException('VALIDATION_FAILED', { message: `แนบหลักฐานได้สูงสุด ${MAX_EVIDENCE_FILES} ไฟล์ต่อครั้ง` });
    }

    const order = await this.requireOpenable(buyerId, orderId);

    const storedFiles = await this.files.storeImages(uploads);

    const opened = await this.prisma
      .$transaction(async (tx) => {
        // §91: the checks above ran before the evidence was re-encoded, which takes long enough
        // for the refund to complete (the buyer confirming it in another tab) — they are made
        // again here under the order's lock, which that confirmation's write waits on. And under
        // the account's, like every other write of the buyer's own words (§84): the reason is
        // overwritten by their erasure.
        await lockLiveAccount(tx, buyerId);
        // §96: and the shop owner's. Their erasure waits out this order's dispute window (§94), and
        // decides under this same row's lock — held here, the window is judged once, now, and the
        // erasure either sees this dispute or has committed before the window is judged (closed).
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${order.shop.ownerId}::uuid FOR SHARE`;
        const openedAt = this.clock.now();
        await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${order.id}::uuid FOR SHARE`;
        const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        if (current.status === 'REFUNDED') {
          throw new AppException('CONFLICT', { message: 'ออเดอร์นี้คืนเงินเสร็จสิ้นแล้ว เปิดข้อพิพาทใหม่ไม่ได้' });
        }
        // §96: judged at `openedAt`, not the `now` from before the evidence was re-encoded — that
        // could let a dispute in after its window closed (and after the seller was erased for it).
        if (!canOpenDisputeNow(current, openedAt)) {
          throw new AppException('CONFLICT', { message: 'หมดสิทธิ์เปิดข้อพิพาทสำหรับออเดอร์นี้แล้ว' });
        }

        return tx.dispute.create({
          data: {
            id: newId(),
            orderId: order.id,
            shopId: order.shopId,
            openedBy: buyerId,
            reason: dto.reason,
            createdAt: openedAt,
            updatedAt: openedAt,
            evidence: {
              create: storedFiles.map((file) => ({
                id: newId(),
                party: 'BUYER',
                uploadedBy: buyerId,
                fileId: file.id,
                createdAt: openedAt,
              })),
            },
          },
          include: DISPUTE_INCLUDE,
        });
      })
      .catch(async (error: unknown) => {
        // §85: a dispute that was never created leaves no evidence files behind on disk.
        await this.discardAll(storedFiles);
        if (isUniqueViolation(error)) {
          // K13: lost the race against another OPEN dispute on this same order.
          throw new AppException('CONFLICT', {
            message: 'ออเดอร์นี้มีข้อพิพาทที่เปิดอยู่แล้ว ต้องปิดเรื่องเดิมก่อนจึงจะเปิดเรื่องใหม่ได้',
          });
        }
        throw error;
      });

    // §85: in-app only — the shop is the side that has to answer, and nothing used to tell it.
    // After the create, outside the try: a failed notice must never discard evidence already saved.
    await this.notifications.notify({
      userId: order.shop.ownerId,
      type: 'DISPUTE_OPENED',
      message: 'ผู้ซื้อเปิดข้อพิพาทกับออเดอร์นี้ กรุณาตอบพร้อมหลักฐานที่หน้าออเดอร์',
      targetType: 'ORDER',
      targetId: order.id,
    });
    // §102: and the admins of its community, who have to rule on it — nothing used to tell them.
    for (const userId of await communityAdminsToNotify(this.prisma, order.shop.communityId, { buyerId, shopOwnerId: order.shop.ownerId })) {
      await this.notifications.notify({
        userId,
        type: 'DISPUTE_AWAITING_RULING',
        message: 'มีข้อพิพาทใหม่ในชุมชนที่คุณดูแล รอแอดมินตัดสิน',
        targetType: 'DISPUTE',
        targetId: opened.id,
      });
    }

    return DisputeDto.from(opened);
  }

  /**
   * The buyer's own order, open to a new dispute right now. Also asked by the upload route before the
   * evidence is read (§100, `@AcceptsUpload`) — ten photos for an order that could never take a
   * dispute are refused before they cost anything. `open` asks again under the order's lock.
   */
  async requireOpenable(buyerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId }, include: { shop: { select: { ownerId: true, communityId: true } } } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.status === 'REFUNDED') {
      // §85: see `canOpenDisputeNow` — a completed refund is not reopened by a new dispute.
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้คืนเงินเสร็จสิ้นแล้ว เปิดข้อพิพาทใหม่ไม่ได้' });
    }

    // "เปิดได้ตั้งแต่ผู้ซื้ออัปสลิปเป็นต้นไป" — checked against real PaymentSlip rows, not
    // `status`, so a slip that was later rejected (I2, which regresses status to
    // AWAITING_PAYMENT) still counts: the buyer did upload one, which is the actual gate.
    const slipCount = await this.prisma.paymentSlip.count({ where: { orderId } });
    if (slipCount === 0) {
      throw new AppException('CONFLICT', { message: 'เปิดข้อพิพาทได้หลังอัปสลิปโอนเงินแล้วเท่านั้น' });
    }

    if (!canOpenDisputeNow(order, this.clock.now())) {
      throw new AppException('CONFLICT', { message: 'หมดสิทธิ์เปิดข้อพิพาทสำหรับออเดอร์นี้แล้ว' });
    }

    return order;
  }

  /**
   * The open dispute on an order of the caller's shop, not yet answered. Also asked by the upload
   * route before the evidence is read (§100, `@AcceptsUpload`).
   */
  async requireRespondable(ownerId: string, orderId: string): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findFirst({ where: { orderId, order: ownedByShopOwner(ownerId), closedAt: null } });
    if (dispute === null) {
      throw new AppException('NOT_FOUND');
    }
    if (dispute.respondedAt !== null) {
      throw new AppException('CONFLICT', { message: ALREADY_RESPONDED });
    }
    // §102: an answer is for the admin deciding the case. After the ruling it decides nothing and
    // only puts the shop's last word on record where the buyer has none (a BUYER_WINS dispute stays
    // open through the refund loop, which is how this used to be reachable).
    if (dispute.verdict !== null) {
      throw new AppException('CONFLICT', { message: RULED_BEFORE_RESPONSE });
    }
    return dispute;
  }

  /** Every dispute this order has ever had, newest first — buyer's own read. */
  async listForBuyer(buyerId: string, orderId: string): Promise<DisputeDto[]> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId }, select: { id: true } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }

    return this.listFor(order.id);
  }

  /** Same list, the shop-owner's own read. */
  async listForShop(ownerId: string, orderId: string): Promise<DisputeDto[]> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...ownedByShopOwner(ownerId) }, select: { id: true } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }

    return this.listFor(order.id);
  }

  private async listFor(orderId: string): Promise<DisputeDto[]> {
    const rows = await this.prisma.dispute.findMany({
      where: { orderId },
      orderBy: [{ createdAt: 'desc' }],
      include: DISPUTE_INCLUDE,
    });

    return rows.map((row) => DisputeDto.from(row));
  }

  /**
   * J2: a suspended shop responds exactly as normally as it ships or confirms payment — nothing
   * here checks `shop.suspendedAt`, the same restraint `ShippingService.ship` already documents.
   * Set once: a second attempt is a 409, the same minimalism #60 chose for "no review edits past
   * the window" rather than an open-ended back-and-forth this ticket's AC never asked for.
   */
  async respond(ownerId: string, orderId: string, dto: RespondDisputeDto, uploads: readonly UploadedTempFile[]): Promise<DisputeDto> {
    if (uploads.length > MAX_EVIDENCE_FILES) {
      throw new AppException('VALIDATION_FAILED', { message: `แนบหลักฐานได้สูงสุด ${MAX_EVIDENCE_FILES} ไฟล์ต่อครั้ง` });
    }

    const dispute = await this.requireRespondable(ownerId, orderId);

    const storedFiles = await this.files.storeImages(uploads);

    const now = this.clock.now();
    try {
      await this.prisma.$transaction(async (tx) => {
        // §91: the shop's answer is the owner's own words, overwritten by their erasure (§84).
        await lockLiveAccount(tx, ownerId);
        // §85: "not answered yet" rides on the write — two answers sent together used to both
        // succeed, the second silently replacing the first.
        const claimed = await tx.dispute.updateMany({
          where: { id: dispute.id, respondedAt: null, closedAt: null, verdict: null },
          data: { shopResponse: dto.response, respondedAt: now, updatedAt: now },
        });
        if (claimed.count === 0) {
          // Lost a race — to another answer, or (§102) to the ruling, landing while the evidence
          // was being re-encoded. Say which: "already answered" is untrue in the second case.
          const current = await tx.dispute.findUniqueOrThrow({ where: { id: dispute.id }, select: { verdict: true } });
          throw new AppException('CONFLICT', { message: current.verdict === null ? ALREADY_RESPONDED : RULED_BEFORE_RESPONSE });
        }

        if (storedFiles.length > 0) {
          await tx.disputeEvidence.createMany({
            data: storedFiles.map((file) => ({
              id: newId(),
              disputeId: dispute.id,
              party: 'SHOP' as const,
              uploadedBy: ownerId,
              fileId: file.id,
              createdAt: now,
            })),
          });
        }
      });
    } catch (error) {
      await this.discardAll(storedFiles);
      throw error;
    }

    const updated = await this.prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id }, include: DISPUTE_INCLUDE });

    return DisputeDto.from(updated);
  }

  /**
   * The evidence file's raw bytes — the buyer or shop's own party-scoped read. A community
   * admin's read of the same file goes through `readEvidenceAsAdmin` below instead, gated by the
   * controller's `@RequiresCommunityAdmin` guard rather than this party check — dispute evidence
   * is case evidence for whoever is judging it, not PII, so it doesn't need break-glass's
   * reason-logged "reveal identity" ceremony the way a slip or an address does.
   */
  async readEvidence(actorUserId: string, disputeId: string, evidenceId: string): Promise<ReadImage> {
    const evidence = await this.prisma.disputeEvidence.findFirst({
      where: { id: evidenceId, disputeId },
      include: { dispute: { select: { orderId: true } } },
    });
    if (evidence === null) {
      throw new AppException('NOT_FOUND');
    }

    await this.requireParty(actorUserId, evidence.dispute.orderId);

    const file = await this.files.readImage(evidence.fileId);
    if (file === null) {
      throw new AppException('NOT_FOUND');
    }

    return file;
  }

  /** Buyer of the order, or the owner of the shop it was placed against — nobody else, ever. */
  private async requireParty(actorUserId: string, orderId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, OR: [{ buyerId: actorUserId }, { shop: { ownerId: actorUserId } }] },
      select: { id: true },
    });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
  }

  /** Best-effort cleanup of files stored for a write that then failed — never masks the original error. */
  private async discardAll(files: StoredImage[]): Promise<void> {
    for (const file of files) {
      await this.files.discardUnattached(file.id).catch(() => undefined);
    }
  }

  /**
   * #64's own reusable answer to "is this order's chat currently break-glass-visible" — the one
   * condition topic 11's chat guard is instructed to call through here rather than reimplement
   * (its own AC names this exact method). Live every time, never a cached flag.
   */
  async isOrderUnderOpenDisputeBreakGlass(orderId: string): Promise<boolean> {
    const openDispute = await this.prisma.dispute.findFirst({ where: { orderId, closedAt: null }, select: { id: true } });

    return openDispute !== null;
  }
}

const ALREADY_RESPONDED = 'ร้านตอบข้อพิพาทนี้ไปแล้ว';
const RULED_BEFORE_RESPONSE = 'ข้อพิพาทนี้มีคำตัดสินแล้ว จึงตอบหรือแนบหลักฐานเพิ่มไม่ได้';




