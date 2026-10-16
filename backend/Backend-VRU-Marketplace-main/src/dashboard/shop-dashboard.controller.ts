import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { DashboardRangeQueryDto } from './dto/dashboard-range-query.dto.js';
import { ShopDashboardDto } from './dto/shop-dashboard.dto.js';
import { ShopDashboardService } from './shop-dashboard.service.js';

/**
 * §127: the shop owner's dashboard. Not `@RefusesAdmins()`: it only reads the caller's own shop, so
 * an admin learns nothing they could not already see. One who never had a shop gets the same 404 as
 * anyone; one who closed a shop before being appointed (N29) still sees that old shop's figures,
 * exactly as `GET /shops/me` still shows it.
 */
@ApiTags('shops')
@ApiCookieAuth('access_token')
@Controller('shops/me/dashboard')
export class ShopDashboardController {
  constructor(private readonly dashboards: ShopDashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'My shop’s dashboard — work waiting, catalogue, confirmed sales, rating',
    description:
      'Order and dispute figures are what is waiting now and match GET /shops/me/orders; sales cover ' +
      'the Thai calendar dates from/to (default: the last 30 days). Works for a suspended shop.',
  })
  @ApiOkResponse({ type: ShopDashboardDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Bad dates.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'The caller has no shop.' })
  async forOwner(@CurrentUser() owner: CurrentUserType, @Query() query: DashboardRangeQueryDto): Promise<ShopDashboardDto> {
    return this.dashboards.forOwner(owner.id, query);
  }
}
