import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app-exception.js';
import { AppConfig } from '../config/app-config.module.js';
import { MS_PER_SECOND } from '../time/clock.js';

/**
 * §100: at most IMAGE_PROCESSING_CONCURRENCY uploads are decoded and re-encoded at once, system-wide.
 *
 * Each one holds its source file and sharp's working memory while it runs, and before this nothing
 * bounded how many could run together: §99 measured one full dispute at ≈200MiB above idle and got
 * the API killed with a burst of them. With the ceiling, a burst costs time instead of memory.
 *
 * An upload that finds every slot taken waits its turn, first come first served, for up to
 * IMAGE_PROCESSING_QUEUE_TIMEOUT_MS, and is then refused with 503 and Retry-After rather than kept
 * waiting until Nginx gives up on it with a bare 504.
 *
 * In memory, like the rate-limit counters — one more thing that assumes one instance (CLAUDE.md).
 */
@Injectable()
export class ImageProcessingGate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly config: AppConfig) {}

  /** Runs `work` once a slot is free, and frees the slot however it ends. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.config.imageProcessingConcurrency) {
      this.running += 1;
      return Promise.resolve();
    }

    const timeoutMs = this.config.imageProcessingQueueTimeoutMs;
    return new Promise<void>((resolve, reject) => {
      const turn = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(turn), 1);
        reject(
          new AppException('SERVICE_UNAVAILABLE', {
            message: 'ระบบกำลังประมวลผลรูปจำนวนมาก กรุณาลองใหม่อีกครั้งในอีกสักครู่',
            retryAfterSeconds: Math.max(1, Math.ceil(timeoutMs / MS_PER_SECOND)),
          }),
        );
      }, timeoutMs);
      this.waiting.push(turn);
    });
  }

  /** Hands the slot straight to the next in line, so `running` never dips and lets a newcomer jump the queue. */
  private release(): void {
    const next = this.waiting.shift();
    if (next === undefined) {
      this.running -= 1;
      return;
    }
    next();
  }
}
