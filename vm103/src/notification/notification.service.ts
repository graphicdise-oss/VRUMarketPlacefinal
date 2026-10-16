import { Injectable, Logger } from '@nestjs/common';
import { errorKindForLog } from '../common/errors/error-kind-for-log.js';
import { newId } from '../common/id.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { EmailKind, EmailSender } from '../email/email-sender.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { NotificationDto } from './dto/notification.dto.js';
import { NOTIFICATION_TYPES_WITH_EMAIL, NotificationTargetType, NotificationType } from './notification-type.js';

/** The name every cursor for this list carries (#18's per-list mismatch check). */
const LIST_NAME = 'notifications';

/**
 * Anything that can write the row: the shared client, or a transactional one from `$transaction`.
 * Same shape and same reason as `AuditLogWriter` — narrowed so a caller passing its own
 * transaction cannot accidentally hand this writer the whole database.
 */
export type NotificationWriter = Pick<PrismaService, 'notification' | 'user'>;

export interface NotificationEntry {
  readonly userId: string;
  readonly type: NotificationType;
  readonly message: string;
  readonly targetType?: NotificationTargetType | null;
  readonly targetId?: string | null;
}

/** Subject and body for the email half of a notification — plain text, per A4/#19. */
export interface NotificationEmail {
  readonly subject: string;
  readonly body: string;
  /**
   * #71: overrides the DB lookup below for the recipient's address. The one caller that needs
   * this is `AccountErasureService` — by the time it calls `notify` to say an erasure completed,
   * the row it would otherwise look up has already had its `email` overwritten by that same
   * erasure, in the same transaction. Every other caller leaves this unset and gets the address
   * read fresh from `User.email`, same as before this field existed.
   */
  readonly recipientEmail?: string;
}

/**
 * The only thing in this codebase that writes to `notification`, and the only thing that ever
 * calls `EmailSender` for anything other than verification/password-reset (#19/#27).
 *
 * Two methods for two situations, the same split `AuditLogService` already has: `record` is the
 * transactional primitive (pass a `$transaction`'s `tx` when the row must commit atomically with
 * the state change it describes — `OrderFreezeService` uses this for freeze/unfreeze, which have
 * no email and no reason to leave the transaction). `notify` is the common case outside a
 * transaction, used by every caller whose event might also be worth an email — it writes the row
 * and then, only for the types I17 names, sends one. Deliberately never called from inside a
 * transaction: `EmailSender.send` is a network call, and #69's own AC is explicit that "การส่ง
 * อีเมลล้มเหลวห้ามทำให้ธุรกรรมหลักล้มตาม" (a failed send must never fail the transaction it would
 * otherwise be sitting inside) — every caller of `notify` in this codebase calls it after its own
 * transaction has already committed, the same "the durable part already happened" discipline the
 * four notification ports established before this ticket existed.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailSender: EmailSender,
    private readonly clock: Clock,
  ) {}

  /**
   * Writes one row. No email — see the class comment for why that half never happens in here.
   *
   * §113: nothing for an erased account — its notices were deleted with it and nobody can sign in
   * to read new ones (an admin can still answer a rejected shop's room after its owner was erased,
   * for one). Read without a lock: a notice racing the erasure itself can still land and stays
   * until the 180-day sweep — accepted, like `hasUnread`'s own race (§84).
   */
  async record(entry: NotificationEntry, client: NotificationWriter = this.prisma): Promise<void> {
    const recipient = await client.user.findUnique({ where: { id: entry.userId }, select: { erasedAt: true } });
    if (recipient === null || recipient.erasedAt !== null) {
      return;
    }
    await this.insert(entry, client);
  }

  private async insert(entry: NotificationEntry, client: NotificationWriter): Promise<void> {
    await client.notification.create({
      data: {
        id: newId(),
        userId: entry.userId,
        type: entry.type,
        message: entry.message,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        // §84: from `Clock`, like every other timestamp this system writes. The column's database
        // default (`now()`) used to fill this in, which put notifications on the database's clock
        // rather than the application's — seam 2 (M5) never moved them, so the 180-day retention
        // sweep could only ever be tested against rows inserted by hand.
        createdAt: this.clock.now(),
      },
    });
  }

  /**
   * §84: whether `userId` still has an unread notification of this type about this target — lets
   * a caller raise one notice per unread thing rather than one per event (a burst of chat
   * messages used to be one row each, twenty rows for twenty messages).
   */
  async hasUnread(userId: string, type: NotificationType, targetId: string): Promise<boolean> {
    const existing = await this.prisma.notification.findFirst({ where: { userId, type, targetId, readAt: null }, select: { id: true } });

    return existing !== null;
  }

  /**
   * §108: marks every recipient's unread notice of this type about this target as read — for a
   * notice several people share one duty over (a community's admins, one inbox), where one of them
   * handling it is all of them having handled it.
   */
  async markReadForEveryone(type: NotificationType, targetId: string, client: NotificationWriter = this.prisma): Promise<void> {
    await client.notification.updateMany({ where: { type, targetId, readAt: null }, data: { readAt: this.clock.now() } });
  }

  /**
   * Writes the row and, for the types I17 names, sends the matching email — neither for an erased
   * account (§113), save the erasure's own closing email.
   *
   * `email` is required exactly when `entry.type` is in `NOTIFICATION_TYPES_WITH_EMAIL`, and
   * rejected otherwise — a thrown, unrecoverable error, the same shape `AuditLogService.record`
   * uses for a missing required reason. This is what makes #69's "เปลี่ยนสถานะธรรมดา →
   * ไม่มีอีเมลออกไปเลย" true by construction: a caller cannot pass an email for an ordinary status
   * change even by mistake, and cannot forget one for a type that needs it without the mistake
   * throwing immediately in every test that exercises it, rather than shipping silently.
   *
   * A failed send is logged (never the recipient address or the body — CLAUDE.md: log only what
   * could be shown in public) and swallowed: the row above already committed, so the notification
   * exists in-app regardless of whether Brevo answered.
   */
  async notify(entry: NotificationEntry, email?: NotificationEmail): Promise<void> {
    const needsEmail = NOTIFICATION_TYPES_WITH_EMAIL.has(entry.type);
    if (needsEmail && email === undefined) {
      throw new Error(`Notification type ${entry.type} requires an email payload, and none was given (I17).`);
    }
    if (!needsEmail && email !== undefined) {
      throw new Error(`Notification type ${entry.type} is not an email type — do not pass one (I17: "ไม่เผลอส่งทุกขั้น").`);
    }

    // §113: no notice and no email for an erased account (see `record`) — its address is a
    // placeholder on a domain that cannot receive mail. `recipientEmail` is the one way past this:
    // the erasure's own closing email, to the address captured before the overwrite.
    const recipient = await this.prisma.user.findUnique({ where: { id: entry.userId }, select: { email: true, erasedAt: true } });
    if (recipient === null) {
      // Unreachable in practice — a Notification always points at a real, un-deletable-by-DELETE
      // User row (invariant 5) — but not worth throwing over if it ever happened.
      return;
    }
    const erased = recipient.erasedAt !== null;
    if (!erased) {
      await this.insert(entry, this.prisma);
    }

    if (email === undefined) {
      return;
    }
    const recipientEmail = email.recipientEmail ?? (erased ? undefined : recipient.email);
    if (recipientEmail === undefined) {
      return;
    }

    // §84: a sender that *throws* (a network error the implementation did not turn into a result)
    // is swallowed the same way as one that reports failure — #69's own AC is that a failed email
    // never fails the request, and every caller of `notify` has already committed by now. Before,
    // a throw here answered 500 for, say, a refund slip that had in fact been saved.
    try {
      const result = await this.emailSender.send({
        to: recipientEmail,
        subject: email.subject,
        body: email.body,
        kind: emailKindFor(entry.type),
      });
      if (!result.sent) {
        this.logger.warn(`Notification email for ${entry.type} failed to send (retryable=${result.retryable}): ${result.reason}`);
      }
    } catch (error) {
      this.logger.warn(`Notification email for ${entry.type} threw while sending: ${errorKindForLog(error)}`);
    }
  }

  /** The caller's own notifications, newest first — nobody else's, ever (scoped by `userId` in the query itself). */
  async listForUser(userId: string, cursor: string | undefined, limit: number): Promise<Page<NotificationDto>> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...keysetAfter(cursor, LIST_NAME) },
      orderBy: newestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, LIST_NAME);

    return { ...page, items: page.items.map((row) => NotificationDto.from(row)) };
  }

  async unreadCountFor(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /**
   * #69's own AC: mark-all only, no per-item read endpoint. Idempotent — a second call touches nothing new.
   * §113: `upToId` bounds it to the notices the caller's screen had shown (ids are UUIDv7, so they
   * order by creation time).
   */
  async markAllRead(userId: string, upToId?: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(upToId === undefined ? {} : { id: { lte: upToId } }) },
      data: { readAt: this.clock.now() },
    });
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: this.clock.now() },
    });
  }
}

/** Which `EmailKind` (#19) a given notification type's email rides under. Only called for types already confirmed to need one. */
function emailKindFor(type: NotificationType): EmailKind {
  switch (type) {
    case 'ORDER_DEADLINE_WARNING_SHIPPING_QUOTE':
    case 'ORDER_DEADLINE_WARNING_PAYMENT':
    case 'ORDER_DEADLINE_WARNING_PAYMENT_CONFIRMATION':
      return 'DEADLINE_WARNING';
    case 'DISPUTE_RULED':
      return 'DISPUTE_OUTCOME';
    case 'ORDER_REFUND_ORDERED_AUTO':
    case 'REFUND_SLIP_UPLOADED':
      return 'ORDER_STATUS';
    case 'ACCOUNT_ERASURE_COMPLETED':
      return 'ACCOUNT_ERASURE';
    default:
      // Unreachable: `notify` only reaches here for a type in NOTIFICATION_TYPES_WITH_EMAIL,
      // which lists exactly the cases above.
      throw new Error(`No EmailKind mapped for notification type ${type}`);
  }
}
