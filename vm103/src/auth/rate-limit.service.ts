import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock, MS_PER_SECOND } from '../time/clock.js';

/**
 * What `consume` decided, and — when it refused — how long the caller must actually wait.
 */
export interface RateLimitOutcome {
  readonly allowed: boolean;
  /**
   * Seconds until the current window closes, rounded up so a caller who waits exactly this long
   * never arrives a moment early. Meaningless — and always 0 — when `allowed` is true.
   */
  readonly retryAfterSeconds: number;
}

/**
 * §130: Rate limit counters backed by PostgreSQL (`rate_limit_counter` table).
 *
 * Persisted in the database so that multiple application instances share the exact same
 * counters without doubling the ceilings or requiring Redis.
 */
@Injectable()
export class RateLimitService {
  constructor(
    private readonly clock: Clock,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Records an attempt against `key` and says whether it is allowed.
   */
  async consume(key: string, max: number, windowMs: number): Promise<RateLimitOutcome> {
    const nowMs = this.clock.nowMs();
    const expiresAt = new Date(nowMs + windowMs);

    const existing = await this.prisma.rateLimitCounter.findUnique({
      where: { key },
    });

    if (!existing || nowMs - Number(existing.startedAtMs) >= windowMs) {
      await this.prisma.rateLimitCounter.upsert({
        where: { key },
        create: {
          key,
          count: 1,
          startedAtMs: BigInt(nowMs),
          expiresAt,
        },
        update: {
          count: 1,
          startedAtMs: BigInt(nowMs),
          expiresAt,
        },
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= max) {
      const remainingMs = Number(existing.startedAtMs) + windowMs - nowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / MS_PER_SECOND));
      return {
        allowed: false,
        retryAfterSeconds,
      };
    }

    await this.prisma.rateLimitCounter.update({
      where: { key },
      data: { count: { increment: 1 } },
    });

    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Forgets every counter.
   */
  async clear(): Promise<void> {
    await this.prisma.rateLimitCounter.deleteMany();
  }

  /**
   * Drops counters whose window has closed. Returns how many went.
   */
  async pruneExpired(nowMs: number): Promise<number> {
    const deleted = await this.prisma.rateLimitCounter.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(nowMs),
        },
      },
    });
    return deleted.count;
  }
}
