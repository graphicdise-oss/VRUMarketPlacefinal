import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { newId } from '../common/id.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** One line of traffic data (§98): who, from where, when, what — never content. */
export interface AccessLogEntry {
  readonly occurredAt: Date;
  readonly ipAddress: string;
  readonly userId: string | null;
  readonly channel: 'HTTP' | 'WEBSOCKET';
  readonly action: string;
  readonly statusCode: number | null;
}

/** Matches `AccessLog.action`'s `@db.VarChar(200)`, so an odd route never fails the write. */
const MAX_ACTION_LENGTH = 200;
/** How often buffered rows are written, and the most one write carries. */
const FLUSH_INTERVAL_MS = 1_000;
const MAX_ROWS_PER_WRITE = 500;
/**
 * The most rows held in memory waiting for a write. Past it new rows are dropped and counted —
 * on a server short on memory, a flood (a scanner, a chat client spamming events, the database
 * stalling) must cost a known amount of RAM, not whatever the flood brings.
 */
const MAX_PENDING_ROWS = 10_000;

/**
 * §98 (owner's decision in §93): writes the traffic data พ.ร.บ.คอมพิวเตอร์ ม.26 asks for.
 *
 * Buffered and written in batches, one write at a time, off the request path: a request is never
 * slowed or refused because its log line could not be kept, and logging every request costs one
 * `createMany` a second rather than one pool connection per request (§98 review).
 *
 * Failures are logged by count and error type only — a Prisma error's message quotes the rows it
 * was given, and those hold IP addresses.
 *
 * Shutdown: `AccessLogModule` is deliberately not global, so Nest destroys it before the global
 * `PrismaModule` disconnects (globals are destroyed last) — the final flush always has a
 * connection. A request that finishes after that (while the HTTP server is closing) is dropped
 * and counted rather than written to a pool that is about to close.
 */
@Injectable()
export class AccessLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccessLogService.name);
  private pending: Prisma.AccessLogCreateManyInput[] = [];
  private dropped = 0;
  private closed = false;
  private writing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    // A pending interval must not keep a finished process (or a test run) alive.
    this.timer.unref();
  }

  record(entry: AccessLogEntry): void {
    if (this.closed || this.pending.length >= MAX_PENDING_ROWS) {
      this.dropped += 1;
      return;
    }
    this.pending.push({ id: newId(), ...entry, action: entry.action.slice(0, MAX_ACTION_LENGTH) });
    if (this.pending.length >= MAX_ROWS_PER_WRITE) {
      void this.flush();
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.closed = true;
    while (this.pending.length > 0 || this.writing !== null) {
      await this.flush();
    }
  }

  /** Writes what is buffered, one batch at a time; a call while a write is running joins it. */
  private flush(): Promise<void> {
    if (this.writing !== null) {
      return this.writing;
    }
    if (this.pending.length === 0) {
      this.reportDropped();
      return Promise.resolve();
    }
    const batch = this.pending.splice(0, MAX_ROWS_PER_WRITE);
    this.writing = this.prisma.accessLog
      .createMany({ data: batch })
      .then(
        () => undefined,
        (error: unknown) => {
          const kind = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof Error ? error.name : 'unknown';
          this.logger.error(`Could not keep ${batch.length} access-log rows (${kind})`);
        },
      )
      .finally(() => {
        this.writing = null;
        this.reportDropped();
      });

    return this.writing;
  }

  private reportDropped(): void {
    if (this.dropped > 0) {
      this.logger.warn(`Dropped ${this.dropped} access-log rows (buffer full or shutting down)`);
      this.dropped = 0;
    }
  }
}
