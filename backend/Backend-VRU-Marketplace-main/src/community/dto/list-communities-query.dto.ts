import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/**
 * No filters yet beyond paging. A search-by-name field is a reasonable future addition, but #30
 * only asks for the plain list that proves the cursor envelope end to end (M3) — adding one now
 * would be a filter nothing calls.
 */
export class ListCommunitiesQueryDto extends PaginationQueryDto {}
