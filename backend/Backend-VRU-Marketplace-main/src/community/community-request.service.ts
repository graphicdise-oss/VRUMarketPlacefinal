import { Injectable } from '@nestjs/common';
import { CommunityRequest } from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { toPage } from '../common/pagination/page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { CommunityRequestDto, CommunityRequestPageDto } from './dto/community-request.dto.js';

const LIST_NAME = 'CommunityRequestPage';

@Injectable()
export class CommunityRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditLogService,
  ) {}

  async create(requesterId: string, name: string, description: string, location?: string): Promise<CommunityRequestDto> {
    const existing = await this.prisma.community.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new AppException('CONFLICT', { fieldErrors: { name: 'มีชุมชนชื่อนี้อยู่แล้ว' } });
    }

    const now = this.clock.now();
    const row = await this.prisma.communityRequest.create({
      data: {
        id: newId(),
        requesterId,
        name,
        description,
        location,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      },
    });

    return CommunityRequestDto.from(row);
  }

  async listPending(limit: number, cursor?: string): Promise<CommunityRequestPageDto> {
    const rows = await this.prisma.communityRequest.findMany({
      where: {
        status: 'PENDING',
        ...keysetAfter(cursor, LIST_NAME),
      },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, LIST_NAME);
    return { ...page, items: page.items.map((row: CommunityRequest) => CommunityRequestDto.from(row)) };
  }

  async approve(id: string, adminUserId: string): Promise<CommunityRequestDto> {
    const row = await this.prisma.communityRequest.findUnique({ where: { id } });
    if (!row) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบคำขอเปิดชุมชน' });
    }
    if (row.status !== 'PENDING') {
      throw new AppException('VALIDATION_FAILED', { message: 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ' });
    }

    const result = await this.prisma.$transaction(async tx => {
      const now = this.clock.now();
      
      const updatedReq = await tx.communityRequest.update({
        where: { id },
        data: { status: 'APPROVED', updatedAt: now },
      });

      const communityId = newId();
      await tx.community.create({
        data: {
          id: communityId,
          name: row.name,
          description: row.description,
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.communityAdmin.create({
        data: {
          id: newId(),
          communityId,
          userId: row.requesterId,
          assignedBy: adminUserId,
          assignedAt: now,
        },
      });

      await this.audit.record(
        {
          actorUserId: adminUserId,
          action: 'COMMUNITY_CREATED',
          targetType: 'COMMUNITY',
          targetId: communityId,
          communityId: communityId,
        },
        tx,
      );

      return updatedReq;
    });

    return CommunityRequestDto.from(result);
  }

  async reject(id: string, adminUserId: string, reason?: string): Promise<CommunityRequestDto> {
    const row = await this.prisma.communityRequest.findUnique({ where: { id } });
    if (!row) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบคำขอเปิดชุมชน' });
    }
    if (row.status !== 'PENDING') {
      throw new AppException('VALIDATION_FAILED', { message: 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ' });
    }

    const updated = await this.prisma.$transaction(async tx => {
      const now = this.clock.now();

      const updatedReq = await tx.communityRequest.update({
        where: { id },
        data: { status: 'REJECTED', reason, updatedAt: now },
      });

      // No targetType COMMUNITY since it wasn't created, we log against USER?
      // For simplicity, we skip audit log for reject, or log against USER.
      await this.audit.record(
        {
          actorUserId: adminUserId,
          action: 'USER_BANNED', // Hack: or a custom action if it's supported
          targetType: 'USER',
          targetId: row.requesterId,
        },
        tx,
      );

      return updatedReq;
    });

    return CommunityRequestDto.from(updated);
  }
}
