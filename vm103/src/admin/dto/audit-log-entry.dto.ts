import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AuditLog } from '@prisma/client';

/**
 * One row of `audit_log`, as the super-admin reader sees it — every column, because nothing on
 * this table today is third-party PII. `reason` is the acting admin's own words, already meant
 * to be shown elsewhere (K12, L3), not something read off the person being acted on.
 *
 * ⚠️ #33's acceptance criteria warns that a future topic's break-glass entries (dispute PII
 * viewed while open) must not turn this endpoint into an indirect way to see that PII. The
 * warning is about what a *later* topic writes into a new column, not about this one — there is
 * nowhere on today's `audit_log` for such a value to hide. Whoever adds that column has to
 * revisit this DTO rather than assume including every column is still safe.
 */
export class AuditLogEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Null means the system itself.',
  })
  actorUserId!: string | null;

  @ApiProperty({ description: 'One of AUDIT_ACTIONS.' })
  action!: string;

  @ApiProperty({ description: 'One of AUDIT_TARGET_TYPES.' })
  targetType!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Null goes with targetType SYSTEM.',
  })
  targetId!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Which community this action was about. Null for platform-level actions with no single ' +
      'community (banning a user, erasing an account). Added 2026-09-22 — rows written before ' +
      'then are null even when the action clearly happened inside a community, because nothing ' +
      'wrote this column yet.',
  })
  communityId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Required for the actions that take something away.',
  })
  reason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(entry: AuditLog): AuditLogEntryDto {
    const dto = new AuditLogEntryDto();
    dto.id = entry.id;
    dto.actorUserId = entry.actorUserId;
    dto.action = entry.action;
    dto.targetType = entry.targetType;
    dto.targetId = entry.targetId;
    dto.communityId = entry.communityId;
    dto.reason = entry.reason;
    dto.createdAt = entry.createdAt;

    return dto;
  }
}
