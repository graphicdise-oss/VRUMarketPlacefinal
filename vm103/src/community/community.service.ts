import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { isUniqueViolation } from '../common/errors/prisma-errors.js';
import { newId } from '../common/id.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { CommunityDto } from './dto/community.dto.js';

/** The name every cursor for this list carries, so a shop or product cursor cannot be replayed here. */
const LIST_NAME = 'communities';

/** §112: the same answer from the pre-check and from `community_name_lower_key`. */
const nameTaken = (): AppException => new AppException('CONFLICT', { fieldErrors: { name: 'มีชุมชนชื่อนี้อยู่แล้ว' } });

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
  ) {}

  /**
   * Every community, newest first, no guard — invariant 1: reading is open to anyone, and
   * `communityId` is a filter the client applies elsewhere, not a membership check here.
   */
  async list(limit: number, cursor: string | undefined): Promise<Page<CommunityDto>> {
    const rows = await this.prisma.community.findMany({
      where: { ...keysetAfter(cursor, LIST_NAME) },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, LIST_NAME);

    return { ...page, items: page.items.map((row) => CommunityDto.from(row)) };
  }

  async getById(id: string): Promise<CommunityDto> {
    const community = await this.prisma.community.findUnique({
      where: { id },
    });
    if (community === null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบชุมชนนี้' });
    }
    return CommunityDto.from(community);
  }

  /** Super admin only — enforced by `@RequiresSuperAdmin()` on the route, not re-checked here. */
  async create(actorUserId: string, name: string, description: string): Promise<CommunityDto> {
    const now = this.clock.now();
    await this.refuseNameTaken(name, null);

    const community = await this.withNameBackstop(() => this.prisma.$transaction(async (tx) => {
      const created = await tx.community.create({
        data: { id: newId(), name, description, createdAt: now, updatedAt: now },
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'COMMUNITY_CREATED',
          targetType: 'COMMUNITY',
          targetId: created.id,
          // The community this action is about is the row itself — the one case where
          // targetId and communityId are the same value, because there is no shop or
          // product to look the community up through yet.
          communityId: created.id,
        },
        tx,
      );

      return created;
    }));

    return CommunityDto.from(community);
  }

  async update(
    actorUserId: string,
    communityId: string,
    name: string,
    description: string,
  ): Promise<CommunityDto> {
    const existing = await this.prisma.community.findUnique({ where: { id: communityId } });

    if (existing === null) {
      throw new AppException('NOT_FOUND');
    }
    await this.refuseNameTaken(name, communityId);

    const updated = await this.withNameBackstop(() => this.prisma.$transaction(async (tx) => {
      const result = await tx.community.update({
        where: { id: communityId },
        data: { name, description, updatedAt: this.clock.now() },
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'COMMUNITY_UPDATED',
          targetType: 'COMMUNITY',
          targetId: result.id,
          communityId: result.id,
        },
        tx,
      );

      return result;
    }));

    return CommunityDto.from(updated);
  }

  /**
   * §112 (the owner's decision): a community created by mistake can go — only while nothing ever
   * hung off it. A shop row of any state (closed and rejected ones included) points at it, and an
   * admin row would be left administering nothing; both also hold a foreign key here. The row is
   * locked first, so a shop or appointment racing the delete waits on it and then finds it gone.
   */
  async remove(actorUserId: string, communityId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [community] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM community WHERE id = ${communityId}::uuid FOR UPDATE`;
      if (community === undefined) {
        throw new AppException('NOT_FOUND', { message: 'ไม่พบชุมชนนี้' });
      }
      const [shops, admins] = await Promise.all([tx.shop.count({ where: { communityId } }), tx.communityAdmin.count({ where: { communityId } })]);
      if (shops > 0 || admins > 0) {
        throw new AppException('CONFLICT', { message: 'ลบได้เฉพาะชุมชนที่ไม่เคยมีร้านและไม่มีแอดมิน' });
      }

      await tx.community.delete({ where: { id: communityId } });
      await this.audit.record({ actorUserId, action: 'COMMUNITY_DELETED', targetType: 'COMMUNITY', targetId: communityId, communityId }, tx);
    });
  }

  /** §112: names compare without letter case (the DTO already trimmed them), as `community_name_lower_key` does. */
  private async refuseNameTaken(name: string, exceptId: string | null): Promise<void> {
    const taken = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM community WHERE lower(name) = lower(${name}) AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid) LIMIT 1
    `;
    if (taken.length > 0) {
      throw nameTaken();
    }
  }

  /** Two creates racing past `refuseNameTaken` meet the unique index — the loser gets the same 409. */
  private async withNameBackstop<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw nameTaken();
      }
      throw error;
    }
  }
}
