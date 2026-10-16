import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { AuditLogQueryService } from './audit-log-query.service.js';
import { AuditLogEntryDto } from './dto/audit-log-entry.dto.js';
import { ListAuditLogQueryDto } from './dto/list-audit-log-query.dto.js';

/**
 * `audit_log`, read-only, super admin only (#33) — closes the loop #15 opened by writing a table
 * nothing could read yet.
 *
 * `@RequiresSuperAdmin()` refuses a community admin exactly the same as an ordinary user: reading
 * this table is not one of the six things invariant 1 grants a community admin, not even for
 * their own community, and that list is closed — opening it is a change to the invariant, not a
 * decision this ticket gets to make.
 */
@ApiTags('admin')
@ApiCookieAuth('access_token')
@RequiresSuperAdmin()
@Controller('admin/audit-log')
export class AdminAuditLogController {
  constructor(private readonly auditLog: AuditLogQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the audit log',
    description:
      'Super admin only — not one of the six actions a community admin may perform, even for ' +
      'their own community. Newest first, filterable by actor and by action. Giving either ' +
      'filter records an AUDIT_LOG_VIEWED entry of its own (once per search, not once per page).',
  })
  @ApiPaginatedResponse(AuditLogEntryDto)
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  async list(
    @CurrentUser() viewer: CurrentUserType,
    @Query() query: ListAuditLogQueryDto,
  ): Promise<Page<AuditLogEntryDto>> {
    return this.auditLog.list(
      viewer.id,
      { actorUserId: query.actorUserId, action: query.action, targetId: query.targetId, communityId: query.communityId },
      query.limit,
      query.cursor,
    );
  }
}
