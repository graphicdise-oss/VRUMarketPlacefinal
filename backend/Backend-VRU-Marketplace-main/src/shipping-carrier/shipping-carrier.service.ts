import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { isUniqueViolation } from '../common/errors/prisma-errors.js';
import { newId } from '../common/id.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { ShippingCarrierDto } from './dto/shipping-carrier.dto.js';

const LIST_NAME = 'shippingCarriers';

/**
 * `ShippingCarrier` (#58, L5): the platform's list of couriers, copied field-for-field from
 * `CategoryService`'s own shape — same super-admin-only write, same open read, same
 * upsert-on-name-conflict-answers-409 pattern.
 *
 * `create`/`update` never accept `isOther` (it is not on either DTO) — the seed is the only place
 * that ever writes `isOther: true`, and letting a super admin set it through this API would risk
 * a second catch-all row existing at once, which `ShippingService.ship` assumes can never happen
 * (it trusts "the carrier I looked up is the isOther one" without re-checking there's only one).
 */
@Injectable()
export class ShippingCarrierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
  ) {}

  async list(includeInactive: boolean, limit: number, cursor: string | undefined): Promise<Page<ShippingCarrierDto>> {
    const rows = await this.prisma.shippingCarrier.findMany({
      where: {
        ...keysetAfter(cursor, LIST_NAME),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, LIST_NAME);

    return { ...page, items: page.items.map((row) => ShippingCarrierDto.from(row)) };
  }

  async create(actorUserId: string, name: string): Promise<ShippingCarrierDto> {
    const existing = await this.prisma.shippingCarrier.findUnique({ where: { name }, select: { id: true } });
    if (existing !== null) {
      throw new AppException('CONFLICT', { message: 'มีบริษัทขนส่งชื่อนี้อยู่แล้ว' });
    }

    const now = this.clock.now();

    try {
      const carrier = await this.prisma.$transaction(async (tx) => {
        const created = await tx.shippingCarrier.create({
          data: { id: newId(), name, isOther: false, isActive: true, createdAt: now, updatedAt: now },
        });

        await this.audit.record(
          { actorUserId, action: 'SHIPPING_CARRIER_CREATED', targetType: 'SHIPPING_CARRIER', targetId: created.id },
          tx,
        );

        return created;
      });

      return ShippingCarrierDto.from(carrier);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException('CONFLICT', { message: 'มีบริษัทขนส่งชื่อนี้อยู่แล้ว' });
      }
      throw error;
    }
  }

  async update(actorUserId: string, carrierId: string, name: string, isActive: boolean): Promise<ShippingCarrierDto> {
    const existing = await this.prisma.shippingCarrier.findUnique({ where: { id: carrierId } });
    if (existing === null) {
      throw new AppException('NOT_FOUND');
    }

    if (name !== existing.name) {
      const nameTaken = await this.prisma.shippingCarrier.findUnique({ where: { name }, select: { id: true } });
      if (nameTaken !== null) {
        throw new AppException('CONFLICT', { message: 'มีบริษัทขนส่งชื่อนี้อยู่แล้ว' });
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.shippingCarrier.update({
          where: { id: carrierId },
          data: { name, isActive, updatedAt: this.clock.now() },
        });

        await this.audit.record(
          { actorUserId, action: 'SHIPPING_CARRIER_UPDATED', targetType: 'SHIPPING_CARRIER', targetId: result.id },
          tx,
        );

        return result;
      });

      return ShippingCarrierDto.from(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException('CONFLICT', { message: 'มีบริษัทขนส่งชื่อนี้อยู่แล้ว' });
      }
      throw error;
    }
  }
}
