import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

/**
 * No filters beyond paging — the community scope is computed from the caller (their
 * `CommunityAdmin` rows, or every community for a super admin), not something the client passes.
 */
export class ListPendingShopsQueryDto extends PaginationQueryDto {}
