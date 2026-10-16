import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty, getSchemaPath } from '@nestjs/swagger';

/**
 * The envelope, described for the generated OpenAPI document (M4).
 *
 * `items` is declared in `ApiPaginatedResponse` below rather than here, because its element type
 * differs per endpoint and Swagger needs a concrete schema reference. This class carries the two
 * fields that are the same everywhere.
 */
export class PageMetaDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Pass back as ?cursor= to get the next page. Null on the last page. Opaque: do not build or parse one.',
    example: 'eyJsaXN0Ijoic2hvcHMiLCJpZCI6IjAxOTI...',
  })
  nextCursor!: string | null;

  @ApiProperty({
    description:
      'Whether another page exists. Equivalent to nextCursor !== null, and present so a "load more" button reads one boolean.',
  })
  hasMore!: boolean;
}

/**
 * Documents a paginated endpoint, with `items` typed to the given DTO.
 *
 * ```ts
 * @Get()
 * @ApiPaginatedResponse(ShopSummaryDto)
 * async list(@Query() query: ListShopsQueryDto): Promise<Page<ShopSummaryDto>> { … }
 * ```
 *
 * Without this, a generic return type comes out of the generator as an untyped object and the
 * frontend loses the one thing the document was for. Writing the schema by hand per endpoint would
 * be the hand-maintained API description M4 refused.
 *
 * Note what is absent from the schema: `total` and `page` (M3). Their absence is part of the
 * contract, so it belongs in the document rather than only in prose.
 */
export function ApiPaginatedResponse<T extends Type<unknown>>(itemType: T): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(PageMetaDto, itemType),
    ApiOkResponse({
      description: `A page of ${itemType.name}. No total and no page number: this API is cursor-paginated (M3).`,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageMetaDto) },
          {
            type: 'object',
            required: ['items'],
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(itemType) } },
            },
          },
        ],
      },
    }),
  );
}
