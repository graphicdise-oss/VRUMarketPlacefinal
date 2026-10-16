import { Global, Module } from '@nestjs/common';
import { NotificationRetentionSweepTask } from './notification-retention.sweep-task.js';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';

/**
 * `Notification` (#69), for the whole application.
 *
 * `@Global()` the same way `EmailModule`/`AuditModule` are: nearly every feature module ends up
 * needing to raise a notification (order status changes, dispute rulings, product moderation,
 * shop suspension, a new chat message), and importing `NotificationModule` into each of them
 * individually would be the "every module reaches for the same thing" case those two modules
 * already exist to avoid.
 */
@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRetentionSweepTask],
  exports: [NotificationService],
})
export class NotificationModule {}
