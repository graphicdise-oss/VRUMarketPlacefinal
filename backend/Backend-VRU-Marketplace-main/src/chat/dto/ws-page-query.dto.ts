import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { clampPageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../common/pagination/cursor.js';

/**
 * `PaginationQueryDto`'s own `@Transform` only ever sees a query-string value (`typeof value ===
 * 'string'`), because every other paginated endpoint in this system is HTTP. A chat event's
 * payload is a JSON object, so `limit` arrives as a real `number` already — this is the same
 * clamp-not-reject rule from #18, adapted for that one difference in transport.
 */
export class WsPageQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    clampPageSize(typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined),
  )
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
