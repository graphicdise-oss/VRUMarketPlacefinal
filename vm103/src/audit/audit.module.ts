import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service.js';

/**
 * Global because almost every later topic has an admin action to record, and making each of
 * them remember an import is how one of them ends up not recording anything.
 *
 * There is no controller here on purpose. Writing is not something a client does — an entry is
 * a side effect of an action that already has its own endpoint — and reading needs the admin
 * guard, which does not exist until topic 3 (#33 owns the read endpoint).
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
