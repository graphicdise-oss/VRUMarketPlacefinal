import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { CategoryDto } from './dto/category.dto.js';

/** The name every cursor for this list carries, matching #18's per-list mismatch check. */
const LIST_NAME = 'categories';

/**
 * The platform's one flat set of product categories (#40). Super-admin-owned; a community admin
 * has no say here, per invariant 1's closed list of six things a community admin may do.
 */
@Injectable()
export class CategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
  ) {}

  /**
   * Every category, newest first, no guard (K6/L5: reading is open to anyone, so a search page
   * can build its filter list without a session). `includeInactive` defaults to excluding
   * retired categories — the one consumer this ticket names is a search filter, and a category
   * nobody may choose anymore has no reason to appear as a choice.
   */
  async list(
    includeInactive: boolean,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<CategoryDto>> {
    const rows = await this.prisma.category.findMany({
      where: {
        ...keysetAfter(cursor, LIST_NAME),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, LIST_NAME);

    return { ...page, items: page.items.map((row) => CategoryDto.from(row)) };
  }

  /** Super admin only — enforced by `@RequiresSuperAdmin()` on the route, not re-checked here. */
  async create(actorUserId: string, name: string): Promise<CategoryDto> {
    const existing = await this.prisma.category.findUnique({
      where: { name },
      select: { id: true },
    });
    if (existing !== null) {
      // Same call as CommunityAdminService's duplicate-assign: answering CONFLICT rather than
      // quietly succeeding means two admins creating the same name at once do not both believe
      // *they* created it, and it tells the caller their exact name is already taken rather than
      // returning someone else's row under it.
      throw new AppException('CONFLICT', { message: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
    }

    const now = this.clock.now();

    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: { id: newId(), name, isActive: true, createdAt: now, updatedAt: now },
        });

        await this.audit.record(
          { actorUserId, action: 'CATEGORY_CREATED', targetType: 'CATEGORY', targetId: created.id },
          tx,
        );

        return created;
      });

      return CategoryDto.from(category);
    } catch (error) {
      // The check above loses the race when two creates for the same name arrive together; the
      // `@unique` column catches it. Mapped to the same 409 the check produces, matching the
      // pattern `CommunityAdminService.assign()` and `ShopService.apply()` already established.
      if (isUniqueViolation(error)) {
        throw new AppException('CONFLICT', { message: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
      }
      throw error;
    }
  }

  /** Renames and/or retires a category. Both fields replace, same as `CommunityService.update`. */
  async update(
    actorUserId: string,
    categoryId: string,
    name: string,
    isActive: boolean,
  ): Promise<CategoryDto> {
    const existing = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (existing === null) {
      throw new AppException('NOT_FOUND');
    }

    if (name !== existing.name) {
      const nameTaken = await this.prisma.category.findUnique({
        where: { name },
        select: { id: true },
      });
      if (nameTaken !== null) {
        throw new AppException('CONFLICT', { message: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.category.update({
          where: { id: categoryId },
          data: { name, isActive, updatedAt: this.clock.now() },
        });

        await this.audit.record(
          { actorUserId, action: 'CATEGORY_UPDATED', targetType: 'CATEGORY', targetId: result.id },
          tx,
        );

        return result;
      });

      return CategoryDto.from(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException('CONFLICT', { message: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
      }
      throw error;
    }
  }
}

/**
 * Whether Prisma is reporting a unique-constraint violation (P2002).
 *
 * A fifth copy of the same check `AuthService`, `GoogleAuthService`, `CommunityAdminService` and
 * `ShopService` each already carry. Consolidating all five is a real cleanup, but it is not this
 * ticket's diff to widen — flagged in `docs/PROGRESS.md` instead.
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
