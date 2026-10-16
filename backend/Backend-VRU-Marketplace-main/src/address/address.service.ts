import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { lockLiveAccount } from '../common/live-account-lock.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { MAX_ADDRESSES_PER_ACCOUNT } from './address-policy.js';
import { AddressDto } from './dto/address.dto.js';
import { CreateAddressDto } from './dto/create-address.dto.js';
import { UpdateAddressDto } from './dto/update-address.dto.js';

const LIST_NAME = 'addresses';

/** What every read query includes — the chain `AddressDto.from` needs, fetched in one query. */
const ADDRESS_INCLUDE = {
  subdistrictPostalCode: {
    include: {
      subdistrict: {
        include: {
          district: {
            include: { province: true },
          },
        },
      },
    },
  },
} satisfies Prisma.AddressInclude;

/**
 * `Address` (#47): a buyer's saved delivery addresses. Every method here is scoped to the
 * caller's own `userId` — spec 6/12's AC ("ผู้ใช้ ก. อ่านหรือแก้ที่อยู่ของผู้ใช้ ข. ไม่ได้") is
 * enforced by every query filtering on it directly, not by a guard checked separately, which is
 * why a mismatched id and a nonexistent one both answer the identical `NOT_FOUND` — there is
 * nothing here for a stranger's id to be distinguishable from "does not exist" by.
 *
 * There is deliberately no seller- or admin-facing read anywhere in this file: spec 6/12's own AC
 * rules that out by name ("ใบนี้จึงไม่มี endpoint ให้ผู้ขายอ่านตาราง Address ของใคร"). A seller
 * sees a delivery name and phone only once topic 7 copies them onto an order as a snapshot.
 */
@Injectable()
export class AddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * Saves a new address. The very first live address for a person becomes their default
   * automatically — otherwise a buyer with exactly one address could still have none marked
   * default, which is a state nothing in this module ever needs to exist. Any address after the
   * first stays `isDefault: false` unless `POST /addresses/:id/default` is called for it.
   *
   * §113: at most `MAX_ADDRESSES_PER_ACCOUNT` live addresses, counted under the address-book lock
   * so two saves at once cannot both see 9.
   */
  async create(userId: string, dto: CreateAddressDto): Promise<AddressDto> {
    await this.requireSubdistrictPostalCode(dto.subdistrictPostalCodeId);
    const now = this.clock.now();

    const row = await this.prisma.$transaction(async (tx) => {
      await lockAddressBook(tx, userId);
      const live = await tx.address.count({ where: { userId, deletedAt: null } });
      if (live >= MAX_ADDRESSES_PER_ACCOUNT) {
        throw new AppException('CONFLICT', { message: `บันทึกที่อยู่ได้สูงสุด ${MAX_ADDRESSES_PER_ACCOUNT} รายการ กรุณาลบที่อยู่ที่ไม่ใช้ออกก่อน` });
      }

      return tx.address.create({
        data: {
          id: newId(),
          userId,
          recipientName: dto.recipientName,
          phone: dto.phone,
          houseNumber: dto.houseNumber,
          villageNumber: dto.villageNumber ?? null,
          alley: dto.alley ?? null,
          road: dto.road ?? null,
          subdistrictPostalCodeId: dto.subdistrictPostalCodeId,
          isDefault: live === 0,
          createdAt: now,
          updatedAt: now,
        },
        include: ADDRESS_INCLUDE,
      });
    });

    return AddressDto.from(row);
  }

  /** The caller's own addresses, newest first, excluding soft-deleted ones. */
  async list(userId: string, limit: number, cursor: string | undefined): Promise<Page<AddressDto>> {
    const rows = await this.prisma.address.findMany({
      where: { ...keysetAfter(cursor, LIST_NAME), userId, deletedAt: null },
      orderBy: newestFirst(),
      take: limit + 1,
      include: ADDRESS_INCLUDE,
    });

    const page = toPage(rows, limit, LIST_NAME);

    return { ...page, items: page.items.map((row) => AddressDto.from(row)) };
  }

  async get(userId: string, id: string): Promise<AddressDto> {
    const row = await this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
      include: ADDRESS_INCLUDE,
    });
    if (row === null) {
      throw new AppException('NOT_FOUND');
    }

    return AddressDto.from(row);
  }

  /** Full replace, same shape as creation — see `UpdateAddressDto`'s own comment for why. */
  async update(userId: string, id: string, dto: UpdateAddressDto): Promise<AddressDto> {
    await this.requireSubdistrictPostalCode(dto.subdistrictPostalCodeId);

    const row = await this.prisma.$transaction(async (tx) => {
      await lockAddressBook(tx, userId);
      await requireOwned(tx, userId, id);
      return tx.address.update({
        where: { id },
        data: {
          recipientName: dto.recipientName,
          phone: dto.phone,
          houseNumber: dto.houseNumber,
          villageNumber: dto.villageNumber ?? null,
          alley: dto.alley ?? null,
          road: dto.road ?? null,
          subdistrictPostalCodeId: dto.subdistrictPostalCodeId,
          updatedAt: this.clock.now(),
        },
        include: ADDRESS_INCLUDE,
      });
    });

    return AddressDto.from(row);
  }

  /**
   * Makes this the caller's one default address, unsetting whichever one held that spot before —
   * both in the same transaction, so no request in between can ever observe two defaults or zero.
   * Idempotent: calling this on the address that is already default just re-confirms it, rather
   * than answering an error for a call that asked for a state already true.
   */
  async setDefault(userId: string, id: string): Promise<AddressDto> {
    const now = this.clock.now();

    const row = await this.prisma.$transaction(async (tx) => {
      await lockAddressBook(tx, userId);
      await requireOwned(tx, userId, id);
      await tx.address.updateMany({
        where: { userId, isDefault: true, deletedAt: null, id: { not: id } },
        data: { isDefault: false, updatedAt: now },
      });

      return tx.address.update({
        where: { id },
        data: { isDefault: true, updatedAt: now },
        include: ADDRESS_INCLUDE,
      });
    });

    return AddressDto.from(row);
  }

  /**
   * Soft delete (spec 6/12): the row stays, because an old order's snapshot carries this address's
   * id nowhere — invariant 5 already copies everything onto the order itself — but deleting the
   * row outright would still break any future feature that does keep a reference. A deleted
   * address's `isDefault` is left as-is: excluded from the partial unique index, it cannot block
   * a new default from being chosen, and nothing reads `isDefault` on a row `deletedAt` already
   * excludes from every query.
   *
   * §80: if the row just removed *was* the default, promote the most recently added remaining
   * address to take its place — mirroring `create()`'s own invariant that a person with any live
   * addresses always has exactly one marked default.
   */
  async remove(userId: string, id: string): Promise<void> {
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      await lockAddressBook(tx, userId);
      await requireOwned(tx, userId, id);
      const removed = await tx.address.update({
        where: { id },
        data: { deletedAt: now, updatedAt: now },
        select: { isDefault: true },
      });

      if (!removed.isDefault) {
        return;
      }

      const replacement = await tx.address.findFirst({
        where: { userId, deletedAt: null },
        orderBy: newestFirst(),
        select: { id: true },
      });

      if (replacement !== null) {
        await tx.address.update({ where: { id: replacement.id }, data: { isDefault: true, updatedAt: now } });
      }
    });
  }

  /**
   * This ticket's own AC: a subdistrict-postal-code id must be a real row, never free text.
   *
   * §80: `subdistrictPostalCodeId` is a field in the request *body*, so a stale one (the picker's
   * cached list went out of date, or a client just sends garbage) is a validation problem, not a
   * missing resource — `VALIDATION_FAILED` + `fieldErrors` (L4) rather than `NOT_FOUND`, the same
   * distinction `ChatService` already draws for its own body-field foreign key (`fileId`). Before
   * this fix POST answered 404 for a route that exists, and PATCH's 404 was ambiguous between
   * "this address was deleted" and "the postal code picker was stale" — two different screens a
   * frontend cannot tell apart from the code alone.
   */
  private async requireSubdistrictPostalCode(id: string): Promise<void> {
    const row = await this.prisma.subdistrictPostalCode.findUnique({
      where: { id },
      select: { id: true },
    });
    if (row === null) {
      throw new AppException('VALIDATION_FAILED', {
        fieldErrors: { subdistrictPostalCodeId: 'ไม่พบตำบล/รหัสไปรษณีย์ที่เลือก' },
      });
    }
  }
}

/**
 * §113: every write to one person's address book runs one at a time — `lockLiveAccount`'s
 * exclusive mode on the account's row. The "is this the first one", "is there still a default"
 * and "how many are there" reads each decide a write, and two requests interleaving between that
 * read and that write used to leave live addresses with no default, or edit and make default an
 * address deleted in between (§80 had patched two of those with retries; the lock closes the whole
 * family). Erasure pairing (§84/§91) comes with the same lock.
 */
async function lockAddressBook(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await lockLiveAccount(tx, userId, { exclusive: true });
}

/**
 * The address must exist, be live and belong to the caller — read under the address-book lock, so
 * one deleted a moment ago answers 404 rather than being edited or made the default. A mismatched
 * owner and a nonexistent id are deliberately indistinguishable: there is no privilege boundary
 * here worth telling them apart for (contrast `CommunityScopeGuard`).
 */
async function requireOwned(tx: Prisma.TransactionClient, userId: string, id: string): Promise<void> {
  const row = await tx.address.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
  if (row === null) {
    throw new AppException('NOT_FOUND');
  }
}
