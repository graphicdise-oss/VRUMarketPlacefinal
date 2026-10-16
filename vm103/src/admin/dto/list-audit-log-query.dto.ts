import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AUDIT_ACTIONS, type AuditAction } from '../../audit/audit-action.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/**
 * #33's two required filters — "กรองได้อย่างน้อยด้วยผู้กระทำและชนิดของการกระทำ" — plus the paging
 * every list carries. Both optional and combinable: giving both narrows to "this admin, doing
 * this kind of thing", which is the shape a complaint investigation usually starts from.
 */
export class ListAuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only entries this user performed.' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({
    enum: AUDIT_ACTIONS,
    description: 'Only entries of this action. Anything outside the closed vocabulary is 400.',
  })
  @IsOptional()
  @IsIn([...AUDIT_ACTIONS])
  action?: AuditAction;

  @ApiPropertyOptional({ format: 'uuid', description: '§112: only entries about this row — a shop, a product, an order, a user.' })
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '§112: only entries recorded against this community (rows before 2026-09-22 carry none).' })
  @IsOptional()
  @IsUUID()
  communityId?: string;
}
