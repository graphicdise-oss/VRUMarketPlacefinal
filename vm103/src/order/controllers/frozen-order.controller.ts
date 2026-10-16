import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { RequiresCommunityAdmin } from '../../community/decorators/requires-community-admin.decorator.js';
import { FrozenOrderAdminDto } from '../dto/frozen-order-admin.dto.js';
import { RuleFrozenOrderDto } from '../dto/rule-frozen-order.dto.js';
import { OrderIdScopeResolver } from '../order-id.scope-resolver.js';
import { FrozenOrderService } from '../services/frozen-order.service.js';

/**
 * #62: a community admin's (or super admin's) view of one order, and the one decision they may
 * make about it while it's frozen. Both routes go through `@RequiresCommunityAdmin(OrderIdScopeResolver)`
 * — the same two-layer guard (#32) every other community-admin surface uses, never a bespoke
 * check written here.
 */
@ApiTags('orders')
@ApiCookieAuth('access_token')
@Controller('orders')
export class FrozenOrderController {
  constructor(private readonly frozenOrders: FrozenOrderService) {}

  @Get(':orderId/admin-view')
  @RequiresCommunityAdmin(OrderIdScopeResolver)
  @ApiOperation({
    summary: 'View an order the way a community admin may — masked (I5)',
    description:
      'Items, amounts, status, freeze reasons, and whether a slip exists — never the buyer’s ' +
      'name, address, phone, or the slip file itself. That PII exists only through #64’s ' +
      'break-glass route while a dispute is open, never here.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 200, type: FrozenOrderAdminDto })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this order’s shop’s community admin, and not super admin.',
  })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async adminView(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<FrozenOrderAdminDto> {
    return this.frozenOrders.adminView(orderId);
  }

  @Post(':orderId/freeze-ruling')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresCommunityAdmin(OrderIdScopeResolver)
  @ApiOperation({
    summary: 'Rule on a frozen order — release it, or terminate it (I4)',
    description:
      'Only two choices, and the caller never picks TERMINATE’s destination — the system does, ' +
      'from H5’s own unpaid/paid line. Refuses outright if the order is not currently frozen.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'Missing/too-short reason, an unknown verdict, or an extra field like a destination.',
  })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this order’s shop’s community admin, and not super admin.',
  })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'This order is not currently frozen.' })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async rule(
    @CurrentUser() actor: CurrentUserType,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RuleFrozenOrderDto,
  ): Promise<void> {
    await this.frozenOrders.rule(actor.id, orderId, dto);
  }
}
