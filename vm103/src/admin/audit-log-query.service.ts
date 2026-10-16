import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-action.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogEntryDto } from './dto/audit-log-entry.dto.js';

/** The name every cursor for this list carries, matching #18's per-list mismatch check. */
const LIST_NAME = 'auditLog';

export interface AuditLogFilters {
  readonly actorUserId?: string;
  readonly action?: AuditAction;
  readonly targetId?: string;
  readonly communityId?: string;
}

/**
 * Reads `audit_log` for #33 — the closing half of #15's "write it, decide who reads it later".
 *
 * Deliberately its own service rather than a method added to `AuditLogService`: that class's own
 * doc comment frames it as "the only thing in this codebase that writes to audit_log", and a
 * `list()` method living beside `record()` would blur which one to reach for on a topic that
 * only wants to read.
 *
 * Ordered purely by id, the same as every other list in this system (`newestFirst`) — UUIDv7's
 * timestamp prefix already makes that "newest first", and the random suffix already breaks a tie
 * between two rows created in the same millisecond, so there is no second sort column to add for
 * the tie-break #33 asks for.
 */
@Injectable()
export class AuditLogQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * `viewerId` is the super admin making the request — not part of `filters`, because it is
   * never itself something to filter *by*, only who to credit the search to.
   *
   * Opening the log with no filter at all is not recorded: that is "checking the board", not
   * targeting anyone, and logging every open would make `AUDIT_LOG_VIEWED` the single largest
   * action in the table for no investigative value (2026-09-22 code review, at the project
   * owner's direction). Giving any filter (§112: `targetId`/`communityId` too) is a deliberate search, and only the
   * first page of a given search is recorded — turning the page with `cursor` set is still the
   * same search, and logging every page of it would drown out the one entry that matters.
   *
   * Recorded before the read runs: if the write fails, the whole request fails rather than
   * silently serving results nobody can prove were served (fail closed, same reasoning as
   * `AuditLogService.record()` throwing on a missing required reason).
   */
  async list(
    viewerId: string,
    filters: AuditLogFilters,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<AuditLogEntryDto>> {
    const isFirstPageOfASearch =
      cursor === undefined && Object.values(filters).some((value) => value !== undefined);

    if (isFirstPageOfASearch) {
      // Searching for a person is the more specific fact — record who was searched for. A bare
      // action filter ("show me every REVIEW_DELETED") is not about one person, so it has no
      // single target and falls to SYSTEM, the same as any other action with no one row it did
      // something to. §112: a community searched for is recorded as the target too; a `targetId`
      // carries no type to record it under, so it is written into the reason — either way the
      // entry still says what was looked up.
      await this.audit.record({
        actorUserId: viewerId,
        action: 'AUDIT_LOG_VIEWED',
        ...searchedSubject(filters),
        reason: filters.targetId !== undefined ? `targetId=${filters.targetId}` : null,
      });
    }

    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...keysetAfter(cursor, LIST_NAME),
        ...(filters.actorUserId !== undefined ? { actorUserId: filters.actorUserId } : {}),
        ...(filters.action !== undefined ? { action: filters.action } : {}),
        ...(filters.targetId !== undefined ? { targetId: filters.targetId } : {}),
        ...(filters.communityId !== undefined ? { communityId: filters.communityId } : {}),
      },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, LIST_NAME);

    return { ...page, items: page.items.map((row) => AuditLogEntryDto.from(row)) };
  }
}

/** The subject an `AUDIT_LOG_VIEWED` entry names: the person searched for, else the community, else none. */
function searchedSubject(filters: AuditLogFilters): { targetType: 'USER' | 'COMMUNITY' | 'SYSTEM'; targetId: string | null } {
  if (filters.actorUserId !== undefined) {
    return { targetType: 'USER', targetId: filters.actorUserId };
  }
  if (filters.communityId !== undefined) {
    return { targetType: 'COMMUNITY', targetId: filters.communityId };
  }

  return { targetType: 'SYSTEM', targetId: null };
}
