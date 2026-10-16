import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ApiPaginatedResponse } from '../../common/pagination/page.dto.js';
import type { Page } from '../../common/pagination/page.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { FrozenOrderQueueItemDto } from '../dto/frozen-order-admin.dto.js';
import { FrozenOrderService } from '../services/frozen-order.service.js';

/**
 * §102: the queue of frozen orders an admin has to rule on. Its own path rather than
 * `GET /orders/frozen`, which `GET /orders/:orderId` would claim first and refuse as a bad id.
 */
@ApiTags('orders')
@ApiCookieAuth('access_token')
@Controller('frozen-orders')
export class FrozenOrderQueueController {
  constructor(private readonly frozenOrders: FrozenOrderService) {}

  @Get()
  @ApiOperation({
    summary: 'List frozen orders I may rule on (§102)',
    description:
      'Scoped to the caller like GET /shops/pending: every community for a super admin, the ' +
      'caller’s own communities for a community admin, an empty page for anyone else — and never ' +
      'an order the caller is a party to (N28). Masked like GET /orders/:id/admin-view. ' +
      '`disputeAwaitingRulingId` set = rule on that dispute instead; the freeze route answers 409 until it is ruled (J3).',
  })
  @ApiPaginatedResponse(FrozenOrderQueueItemDto)
  async queue(@CurrentUser() actor: CurrentUserType, @Query() query: PaginationQueryDto): Promise<Page<FrozenOrderQueueItemDto>> {
    return this.frozenOrders.queue(actor.id, actor.role, query.limit, query.cursor);
  }
}
