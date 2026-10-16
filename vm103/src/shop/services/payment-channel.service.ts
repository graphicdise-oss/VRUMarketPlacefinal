import { Injectable, Logger } from '@nestjs/common';
import { PaymentChannelType, Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception.js';
import { newId } from '../../common/id.js';
import { lockLiveAccount } from '../../common/live-account-lock.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../../files/file-storage.service.js';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Clock } from '../../time/clock.js';
import { CreatePaymentChannelDto } from '../dto/create-payment-channel.dto.js';
import { PaymentChannelDto } from '../dto/payment-channel.dto.js';
import { UpdatePaymentChannelDto } from '../dto/update-payment-channel.dto.js';
import { ShopService } from './shop.service.js';

type ChannelRow = Prisma.PaymentChannelGetPayload<object>;

/**
 * #36: a shop owner's own payment channels — reads and writes on the caller's own shop only,
 * resolved through `ShopService.findOwnShopRow` (B2's "1 คน = 1 ร้าน" makes "my shop"
 * unambiguous). L1's buyer-facing view is topic 7's to add, once a real order exists to gate it
 * on; nothing here answers a request from anyone but the owner.
 */
@Injectable()
export class PaymentChannelService {
  private readonly logger = new Logger(PaymentChannelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: ShopService,
    private readonly files: FileStorageService,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
  ) {}

  async create(ownerId: string, dto: CreatePaymentChannelDto): Promise<PaymentChannelDto> {
    const shop = await this.shops.findOwnShopRow(ownerId);
    const now = this.clock.now();

    // §91: bank details are the owner's personal data (K15) — written under the account's
    // `FOR SHARE` lock like the QR image (§87), so none lands on an account mid-erasure.
    const row = await this.prisma.$transaction(async (tx) => {
      await lockLiveAccount(tx, ownerId);
      const created = await tx.paymentChannel.create({
        data: {
          id: newId(),
          shopId: shop.id,
          createdAt: now,
          updatedAt: now,
          ...fieldsFor(dto),
        },
      });
      await this.tellOwner(tx, ownerId, shop.id, 'มีการเพิ่มช่องทางรับเงินของร้าน');
      return created;
    });

    return PaymentChannelDto.from(row);
  }

  async list(ownerId: string): Promise<PaymentChannelDto[]> {
    const shop = await this.shops.findOwnShopRow(ownerId);
    const rows = await this.prisma.paymentChannel.findMany({
      where: { shopId: shop.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return rows.map((row) => PaymentChannelDto.from(row));
  }

  /**
   * The L1/#51 buyer-facing read: by `shopId` directly, not `ownerId` — the caller here is
   * `OrderService`, which has already done the actual gating (the caller is this order's buyer,
   * and the order is in a status where L1 says the channels may be shown). This method itself
   * enforces nothing; it is a plain lookup, same as `list` minus the ownership resolution.
   */
  async listForShop(shopId: string): Promise<PaymentChannelDto[]> {
    const rows = await this.prisma.paymentChannel.findMany({
      where: { shopId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return rows.map((row) => PaymentChannelDto.from(row));
  }

  /**
   * §105: a QR photo is a picture of one number, so it goes when the type or the number it shows
   * changes — a new PromptPay number beside the old number's code sends buyers' money to the old
   * one. Renaming the bank or the account holder keeps it. Saving the channel unchanged is not an
   * edit: nothing is written and the owner is not told.
   */
  async update(ownerId: string, channelId: string, dto: UpdatePaymentChannelDto): Promise<PaymentChannelDto> {
    const owned = await this.requireOwned(ownerId, channelId);
    const next = fieldsFor(dto);

    // §91: the same erasure pairing as `create`, and the channel's own lock — one deleted in the
    // meantime is a 404 (`lockChannel`), not the 500 an update of a missing row used to be.
    const { row, changed, droppedQr } = await this.prisma.$transaction(async (tx) => {
      await lockLiveAccount(tx, ownerId);
      const current = await this.lockChannel(tx, channelId);
      if (sameFields(current, next)) {
        return { row: current, changed: false, droppedQr: null };
      }

      const dropsQr = current.qrImageFileId !== null && payeeChanged(current, next);
      const updated = await tx.paymentChannel.update({
        where: { id: channelId },
        data: { updatedAt: this.clock.now(), ...next, ...(dropsQr ? { qrImageFileId: null } : {}) },
      });
      await this.tellOwner(tx, ownerId, owned.shopId, 'ช่องทางรับเงินของร้านถูกแก้ไข');
      return { row: updated, changed: true, droppedQr: dropsQr ? current.qrImageFileId : null };
    });

    if (changed) {
      await this.discardQuietly(droppedQr);
    }

    return PaymentChannelDto.from(row);
  }

  /**
   * Deletes the channel row, then its QR image (§87 — K1 · PDPA). Before, the image stayed on
   * disk with nothing pointing at it, so a later account erasure could never find it: a PromptPay
   * QR carries its owner's phone or national ID number. No order keeps a copy of it to protect —
   * a buyer only ever reads a channel's current image.
   */
  async remove(ownerId: string, channelId: string): Promise<void> {
    const owned = await this.requireOwned(ownerId, channelId);
    const removed = await this.prisma.$transaction(async (tx) => {
      const channel = await this.lockChannel(tx, channelId);
      await tx.paymentChannel.delete({ where: { id: channelId } });
      await this.tellOwner(tx, ownerId, owned.shopId, 'ช่องทางรับเงินของร้านถูกลบ');
      return channel.qrImageFileId;
    });

    await this.discardQuietly(removed);
  }

  /**
   * Replaces the channel's QR image and deletes the one it replaced (§87, the same shape as a
   * shop logo in §86). The new file is stored before the transaction and discarded if the
   * transaction fails; the old one is deleted only after the new one is committed. The owner's
   * row is locked `FOR SHARE` too, so an upload racing the owner's erasure cannot attach a QR to
   * a shop erasure has just anonymized.
   */
  async setQrImage(ownerId: string, channelId: string, upload: UploadedTempFile): Promise<PaymentChannelDto> {
    const owned = await this.requireOwned(ownerId, channelId);
    const stored = await this.files.storeImage(upload);

    const { row, replaced } = await this.prisma
      .$transaction(async (tx) => {
        await lockLiveAccount(tx, ownerId);
        const channel = await this.lockChannel(tx, channelId);
        const updated = await tx.paymentChannel.update({
          where: { id: channelId },
          data: { qrImageFileId: stored.id, updatedAt: this.clock.now() },
        });
        await this.tellOwner(tx, ownerId, owned.shopId, 'รูป QR ของช่องทางรับเงินถูกเปลี่ยน');
        return { row: updated, replaced: channel.qrImageFileId };
      })
      .catch(async (error: unknown) => {
        await this.files.discardUnattached(stored.id);
        throw error;
      });

    await this.discardQuietly(replaced);

    return PaymentChannelDto.from(row);
  }

  async readQrImage(ownerId: string, channelId: string): Promise<ReadImage> {
    const channel = await this.requireOwned(ownerId, channelId);
    return this.readQrImageBytes(channel);
  }

  /**
   * The L1 buyer-facing counterpart to `readQrImage` — code review of topic 4 (2026-09-22, §77):
   * #36 deliberately built no buyer-facing route for a QR image (only the owner's own), and #51
   * later added `listForShop`/`paymentChannelsFor` for the *list*, which told a buyer whether a
   * channel has one (`hasQrImage`) without ever exposing a way to fetch the bytes — leaving that
   * `true` a dead end. `OrderService.paymentChannelsForImage` calls this after doing the actual
   * gating (same order, same L1 status window `paymentChannelsFor` already enforces); this method
   * itself only resolves `shopId` rather than `ownerId`, mirroring `listForShop` below.
   */
  async readQrImageForShop(shopId: string, channelId: string): Promise<ReadImage> {
    const channel = await this.prisma.paymentChannel.findFirst({
      where: { id: channelId, shopId },
    });
    if (channel === null) {
      throw new AppException('NOT_FOUND');
    }

    return this.readQrImageBytes(channel);
  }

  private async readQrImageBytes(channel: { qrImageFileId: string | null }): Promise<ReadImage> {
    if (channel.qrImageFileId === null) {
      throw new AppException('NOT_FOUND', { message: 'ช่องทางนี้ยังไม่มีรูป QR' });
    }

    const image = await this.files.readImage(channel.qrImageFileId);
    if (image === null) {
      // Unreachable in practice — nothing deletes an UploadedFile row once qrImageFileId points
      // at it — but answering NOT_FOUND rather than a 500 costs nothing and stays honest if that
      // ever stops being true.
      throw new AppException('NOT_FOUND');
    }

    return image;
  }

  /**
   * A mismatched owner and a nonexistent channel id both answer `NOT_FOUND` — same reasoning as
   * `AddressService.requireOwned`: there is no privilege boundary here worth making the two
   * distinguishable for.
   */
  /** The channel row `FOR UPDATE`, so two replacements cannot both read the same "previous" image. */
  private async lockChannel(tx: Prisma.TransactionClient, channelId: string): Promise<ChannelRow> {
    await tx.$queryRaw`SELECT id FROM payment_channel WHERE id = ${channelId}::uuid FOR UPDATE`;
    const channel = await tx.paymentChannel.findUnique({ where: { id: channelId } });
    if (channel === null) {
      throw new AppException('NOT_FOUND');
    }

    return channel;
  }

  /**
   * §105: every change to where this shop gets paid is told to its owner, in the app (the owner's
   * choice) — so a hijacked account swapping the account number or the QR is noticed by the person
   * it belongs to. Says what happened and what to do; never the number itself. Written in the
   * change's own transaction, so there is never a change the owner was not told about, nor a
   * notice for a change that rolled back.
   */
  private async tellOwner(tx: Prisma.TransactionClient, ownerId: string, shopId: string, what: string): Promise<void> {
    await this.notifications.record({
      userId: ownerId,
      type: 'PAYMENT_CHANNEL_CHANGED',
      message: `${what} ถ้าคุณไม่ได้ทำเอง ให้เปลี่ยนรหัสผ่านทันทีและตรวจช่องทางรับเงินของร้าน`,
      targetType: 'SHOP',
      targetId: shopId,
    }, tx);
  }

  /** Best effort once the change is committed: a file that will not delete is logged, not thrown past it. */
  private async discardQuietly(fileId: string | null): Promise<void> {
    if (fileId === null) {
      return;
    }
    await this.files.discardUnattached(fileId).catch(() => {
      this.logger.warn(`Could not delete replaced QR image ${fileId}`);
    });
  }

  /** A channel of the caller's shop. Also asked by the QR upload route before the file is read (§100). */
  async requireOwned(ownerId: string, channelId: string): Promise<ChannelRow> {
    const shop = await this.shops.findOwnShopRow(ownerId);
    const channel = await this.prisma.paymentChannel.findFirst({
      where: { id: channelId, shopId: shop.id },
    });
    if (channel === null) {
      throw new AppException('NOT_FOUND');
    }

    return channel;
  }
}

/**
 * Only the field group `dto.type` actually calls for is persisted — the other group is always
 * written as null, so a channel edited from BANK_TRANSFER to PROMPTPAY (or back) never keeps a
 * stale bank number sitting unused beside a promptPayId, or the reverse.
 */
function fieldsFor(dto: CreatePaymentChannelDto): {
  type: PaymentChannelType;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  promptPayId: string | null;
} {
  const isBankTransfer = dto.type === PaymentChannelType.BANK_TRANSFER;

  return {
    type: dto.type,
    bankName: isBankTransfer ? (dto.bankName ?? null) : null,
    bankAccountNumber: isBankTransfer ? (dto.bankAccountNumber ?? null) : null,
    bankAccountName: isBankTransfer ? (dto.bankAccountName ?? null) : null,
    promptPayId: isBankTransfer ? null : (dto.promptPayId ?? null),
  };
}

type ChannelFields = ReturnType<typeof fieldsFor>;

/** Every field `fieldsFor` writes, so a field added there is compared here without a second edit. */
function sameFields(current: ChannelFields, next: ChannelFields): boolean {
  return (Object.keys(next) as (keyof ChannelFields)[]).every((key) => current[key] === next[key]);
}

/** §105: who the money goes to, as far as a QR photo shows it — the type and its number. */
function payeeChanged(current: ChannelFields, next: ChannelFields): boolean {
  return current.type !== next.type || current.bankAccountNumber !== next.bankAccountNumber || current.promptPayId !== next.promptPayId;
}
