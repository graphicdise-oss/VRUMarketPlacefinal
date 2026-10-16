import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

const ORDER_STATUSES = Object.values(OrderStatus);

/**
 * The caller's identity (buyer or shop owner) already scopes the list; `status` narrows it
 * (§87, #58 — "ร้านเห็นว่าออเดอร์ไหนส่งแล้วแต่ผู้ซื้อยังไม่กดรับ" is `?status=SHIPPED`).
 *
 * Several values are either repeated (`?status=A&status=B`, which Express parses to an array) or
 * comma-separated (`?status=A,B`); both become one list before validation, and any value outside
 * `OrderStatus` is a 400 rather than a filter that silently matches nothing. `frozenAt` is not a
 * status (invariant 7), so a frozen order is listed under the status it is frozen in.
 */
export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ORDER_STATUSES,
    isArray: true,
    description: 'Only orders in one of these statuses. Repeat the parameter or separate values with commas.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toStatusList(value))
  @IsArray()
  @ArrayMaxSize(ORDER_STATUSES.length)
  @IsEnum(OrderStatus, { each: true })
  status?: OrderStatus[];
}

function toStatusList(value: unknown): unknown[] {
  const parts: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
  return parts.flatMap((part) =>
    typeof part === 'string' ? part.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : [part],
  );
}
