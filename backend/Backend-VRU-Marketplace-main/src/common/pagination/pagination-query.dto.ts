import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, clampPageSize } from './cursor.js';

/**
 * The query parameters every paginated endpoint accepts. Extend it rather than re-declaring them:
 *
 * ```ts
 * export class ListShopsQueryDto extends PaginationQueryDto {
 *   @IsOptional() @IsUUID() communityId?: string;
 * }
 * ```
 *
 * Two parameters only. There is no `page` and no `offset`, and adding either would be a second way
 * to paginate that the cursor cannot keep consistent.
 */
export class PaginationQueryDto {
  /**
   * Clamped in the transform, before validation sees it, which is why `@Max` can coexist with a
   * request for 200 without producing an error. #18 requires clamping rather than rejection: a
   * client asking for too many wants as much as it can get, and a 400 turns a performance boundary
   * into a broken screen for something the client cannot fix except by asking again for 50.
   *
   * `@Min`/`@Max` stay as a safety net. If the transform is ever removed, these fail loudly instead
   * of letting an unbounded `take` reach Postgres.
   */
  @ApiPropertyOptional({
    description: `How many items to return. Defaults to ${DEFAULT_PAGE_SIZE}, and anything above ${MAX_PAGE_SIZE} is reduced to ${MAX_PAGE_SIZE} rather than rejected.`,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Transform(({ value }) => clampPageSize(typeof value === 'string' ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  /**
   * The `nextCursor` from the previous response, passed back unchanged.
   *
   * Opaque: its contents are not part of the contract and the only supported way to obtain one is
   * to be given it. The length cap is there because the value reaches a base64 decode and a JSON
   * parse, and an unbounded string is an invitation to make those expensive.
   */
  @ApiPropertyOptional({
    description:
      'The nextCursor from the previous page, passed back as-is. Opaque — do not build or modify one. A cursor from a different list is rejected.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
