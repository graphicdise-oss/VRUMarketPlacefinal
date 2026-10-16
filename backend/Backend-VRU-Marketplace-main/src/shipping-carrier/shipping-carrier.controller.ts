import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { CreateShippingCarrierDto } from './dto/create-shipping-carrier.dto.js';
import { ListShippingCarriersQueryDto } from './dto/list-shipping-carriers-query.dto.js';
import { ShippingCarrierDto } from './dto/shipping-carrier.dto.js';
import { UpdateShippingCarrierDto } from './dto/update-shipping-carrier.dto.js';
import { ShippingCarrierService } from './shipping-carrier.service.js';

/**
 * `ShippingCarrier` (#58, L5): open to read, closed to write — the same split `CategoryController`
 * uses and for the same reason: a shop building its "ship" form needs this list before it has a
 * session-gated reason to fetch it.
 */
@ApiTags('shipping-carriers')
@Controller('shipping-carriers')
export class ShippingCarrierController {
  constructor(private readonly carriers: ShippingCarrierService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List shipping carriers',
    description: 'No session required (L5) — the shop’s own "ship" form is built from this. Retired carriers are excluded by default.',
  })
  @ApiPaginatedResponse(ShippingCarrierDto)
  async list(@Query() query: ListShippingCarriersQueryDto): Promise<Page<ShippingCarrierDto>> {
    return this.carriers.list(query.includeInactive, query.limit, query.cursor);
  }

  @Post()
  @RequiresSuperAdmin()
  @ApiOperation({ summary: 'Add a shipping carrier', description: 'Super admin only. Recorded in audit_log.' })
  @ApiResponse({ status: 201, type: ShippingCarrierDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Name already in use.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async create(@CurrentUser() actor: CurrentUserType, @Body() dto: CreateShippingCarrierDto): Promise<ShippingCarrierDto> {
    return this.carriers.create(actor.id, dto.name);
  }

  @Patch(':id')
  @RequiresSuperAdmin()
  @ApiOperation({
    summary: 'Rename or retire a shipping carrier',
    description: 'Super admin only. Both fields are replaced, not merged. Recorded in audit_log.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ShippingCarrierDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such carrier.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Name already in use.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async update(
    @CurrentUser() actor: CurrentUserType,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShippingCarrierDto,
  ): Promise<ShippingCarrierDto> {
    return this.carriers.update(actor.id, id, dto.name, dto.isActive);
  }
}
