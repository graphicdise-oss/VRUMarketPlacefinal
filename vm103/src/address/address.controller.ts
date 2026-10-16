import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { AddressService } from './address.service.js';
import { AddressDto } from './dto/address.dto.js';
import { CreateAddressDto } from './dto/create-address.dto.js';
import { ListAddressesQueryDto } from './dto/list-addresses-query.dto.js';
import { UpdateAddressDto } from './dto/update-address.dto.js';

/**
 * `Address` (#47) — every route needs a session (no `@Public()` anywhere here: an address is
 * always someone's own), and every route is scoped to the caller's own rows. No route here ever
 * takes another person's id as a filter, and no route exists for a seller or an admin to read
 * this table — see `AddressService`'s own comment for why.
 */
@ApiTags('addresses')
@Controller('addresses')
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Post()
  @ApiOperation({
    summary: 'Save a new delivery address',
    description:
      'Becomes the caller’s default automatically if it is their first address; otherwise use ' +
      'POST /addresses/:id/default to make it one. subdistrictPostalCodeId must be a real row ' +
      'from GET /subdistricts (#46) — free text is rejected. At most 10 live addresses (§113).',
  })
  @ApiResponse({ status: 201, type: AddressDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Invalid fields, or no such subdistrict/postal code (fieldErrors.subdistrictPostalCodeId).' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already 10 saved addresses (§113) — delete one first.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async create(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressDto> {
    return this.addresses.create(actor.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List my delivery addresses',
    description: 'Only the caller’s own, non-deleted addresses — there is no other view of this table.',
  })
  @ApiPaginatedResponse(AddressDto)
  @ApiCookieAuth('access_token')
  async list(
    @CurrentUser() actor: CurrentUserType,
    @Query() query: ListAddressesQueryDto,
  ): Promise<Page<AddressDto>> {
    return this.addresses.list(actor.id, query.limit, query.cursor);
  }

  @Get(':addressId')
  @ApiOperation({ summary: 'View one of my delivery addresses' })
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiResponse({ status: 200, type: AddressDto })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'No such address, not yours, or deleted.',
  })
  @ApiCookieAuth('access_token')
  async view(
    @CurrentUser() actor: CurrentUserType,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ): Promise<AddressDto> {
    return this.addresses.get(actor.id, addressId);
  }

  @Patch(':addressId')
  @ApiOperation({
    summary: 'Edit one of my delivery addresses',
    description: 'Full replace — send every field back, the same as creating it (does not touch isDefault).',
  })
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiResponse({ status: 200, type: AddressDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Invalid fields, or no such subdistrict/postal code (fieldErrors.subdistrictPostalCodeId).' })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'No such address, not yours, or deleted.',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async update(
    @CurrentUser() actor: CurrentUserType,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressDto> {
    return this.addresses.update(actor.id, addressId, dto);
  }

  @Post(':addressId/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make this my default address',
    description:
      'Atomic at the database (a partial unique index) — the previous default, if any, is ' +
      'unset in the same transaction. Idempotent: calling this on the address that is already ' +
      'default just re-confirms it.',
  })
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiResponse({ status: 200, type: AddressDto })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'No such address, not yours, or deleted.',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async setDefault(
    @CurrentUser() actor: CurrentUserType,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ): Promise<AddressDto> {
    return this.addresses.setDefault(actor.id, addressId);
  }

  @Delete(':addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete one of my delivery addresses',
    description:
      'Soft delete (spec 6/12) — old orders keep referencing this row through their own ' +
      'snapshot (invariant 5). A deleted address disappears from GET /addresses and can no ' +
      'longer be selected for a new order.',
  })
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'No such address, not yours, or already deleted.',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async remove(
    @CurrentUser() actor: CurrentUserType,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ): Promise<void> {
    await this.addresses.remove(actor.id, addressId);
  }
}
