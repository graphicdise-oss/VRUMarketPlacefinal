import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/** No extra filter — the list is always "my own, not deleted" (privacy AC), scoped by session. */
export class ListAddressesQueryDto extends PaginationQueryDto {}
