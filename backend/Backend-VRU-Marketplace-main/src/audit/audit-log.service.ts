import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../common/id.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditAction, AuditTargetType, requiresReason } from './audit-action.js';

/**
 * Anything that can write the row: the shared client, or a transactional one from
 * `$transaction`. Narrowed to the single delegate this service touches so that passing a
 * transaction cannot accidentally hand the audit writer the whole database.
 */
export type AuditLogWriter = Pick<PrismaService, 'auditLog'>;

/**
 * One entry to record.
 *
 * `actorUserId` is required but nullable, rather than optional: writing `actorUserId: null`
 * forces the caller to state that the system did this, instead of letting a forgotten field
 * silently produce an anonymous entry.
 *
 * `communityId` is optional, unlike `actorUserId` — deliberately, so that the thirteen writers
 * that existed before this field was added (#33's code review, 2026-09-22) keep compiling
 * unchanged and simply write `null`. A caller that already has a `communityId` in hand (topic 3's
 * community and community-admin writers do) should pass it; every other topic backfills its own
 * writer when `/code-review` reaches it (see DECISIONS.md N22 and the AuditLog model's comment).
 */
export interface AuditEntry {
  readonly actorUserId: string | null;
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId: string | null;
  /** Which community this was about. See the field-level comment above for why it is optional. */
  readonly communityId?: string | null;
  /** Required for the actions in ACTIONS_REQUIRING_REASON; rejected as blank if missing. */
  readonly reason?: string | null;
}

/**
 * The only thing in this codebase that writes to audit_log.
 *
 * CLAUDE.md invariant 1 requires every admin action to be recorded, and leaves no room for
 * each module to do its own recording — a controller that writes the row itself is a
 * controller that will one day return early before it gets there, and the missing entry is
 * invisible precisely because nothing is watching. Everything goes through `record`.
 *
 * There is no update and no delete. Not "none exposed over HTTP" — none at all, so that there
 * is no method for a later ticket to call by accident.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one action.
   *
   * Pass the transactional client when the action itself runs in a transaction:
   *
   *   await this.prisma.$transaction(async (tx) => {
   *     await tx.shop.update(...);
   *     await this.audit.record({ ... }, tx);
   *   });
   *
   * An audit entry that commits while the action it describes rolls back is a record of
   * something that never happened, which is worse than no record at all. The reverse — the
   * action committing without its entry — is what the transaction prevents.
   *
   * Throws if a reason is required and missing. That failure is deliberate and should
   * propagate: a suspension whose reason was lost is not a suspension this project is willing
   * to perform (K12 · L3). It is a programming error, not user input — the DTO validates the
   * reason the admin typed long before this is reached.
   */
  async record(entry: AuditEntry, client: AuditLogWriter = this.prisma): Promise<void> {
    const reason = normaliseReason(entry.reason);

    if (requiresReason(entry.action) && reason === null) {
      throw new Error(
        `Audit action ${entry.action} requires a reason, and none was given. ` +
          'Actions that take something away from someone have to be answerable later ' +
          '(see ACTIONS_REQUIRING_REASON).',
      );
    }

    await client.auditLog.create({
      data: {
        id: newId(),
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        communityId: entry.communityId ?? null,
        reason,
        // created_at comes from the database default, so one clock timestamps every row. The
        // Clock abstraction in #17 governs the deadlines the system reasons about; this is a
        // record of when something physically happened.
      },
    });

    // Logged at debug only, and only the action and the target type. CLAUDE.md: log only what
    // could be shown in public. Ids are not secrets but they are not useful in a log either,
    // and a reason is the admin's words about a person.
    this.logger.debug(`${entry.action} on ${entry.targetType}`);
  }
}

/**
 * Treats a whitespace-only reason as no reason.
 *
 * Without this, `reason: '   '` satisfies the required-reason check and stores a blank, which
 * is how a mandatory field becomes decorative.
 */
function normaliseReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}
