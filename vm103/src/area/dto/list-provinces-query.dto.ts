import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/** No filters — a province is the top of the hierarchy, so there is nothing to scope it by. */
export class ListProvincesQueryDto extends PaginationQueryDto {}
