import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/** No extra filters — the `:shopId` path param already scopes the list. */
export class ListReviewsQueryDto extends PaginationQueryDto {}
