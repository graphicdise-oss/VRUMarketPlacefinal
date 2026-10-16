import { Module } from '@nestjs/common';
import { AccessLogRetentionSweepTask } from './access-log-retention.sweep-task.js';
import { AccessLogService } from './access-log.service.js';

/**
 * §98: traffic data for พ.ร.บ.คอมพิวเตอร์ ม.26. `bootstrap.ts` mounts the HTTP side and
 * `ChatModule` imports this for the socket side.
 *
 * ⚠️ Not `@Global()`, on purpose: Nest destroys global modules last, so as a plain module this is
 * destroyed — and flushes its buffer — before the global `PrismaModule` disconnects. Made global,
 * the order would fall to import order and the last rows could meet a closed pool (§98 review).
 */
@Module({
  providers: [AccessLogService, AccessLogRetentionSweepTask],
  exports: [AccessLogService],
})
export class AccessLogModule {}
