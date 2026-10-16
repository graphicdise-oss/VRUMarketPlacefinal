import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { ApiPaginatedResponse } from '../common/pagination/page.dto.js';
import type { Page } from '../common/pagination/page.js';
import { AreaService } from './area.service.js';
import { DistrictDto } from './dto/district.dto.js';
import { ListDistrictsQueryDto } from './dto/list-districts-query.dto.js';
import { ListProvincesQueryDto } from './dto/list-provinces-query.dto.js';
import { ListSubdistrictsQueryDto } from './dto/list-subdistricts-query.dto.js';
import { ProvinceDto } from './dto/province.dto.js';
import { SubdistrictDto } from './dto/subdistrict.dto.js';

/**
 * Province → district → subdistrict, public and read-only (#46). Three flat, top-level
 * collections rather than nested routes (`/provinces/:id/districts/...`) — a client calls each
 * layer filtered by the parent it already picked, which is the cascading picker's own shape.
 */
@ApiTags('area')
@Controller()
export class AreaController {
  constructor(private readonly area: AreaService) {}

  @Get('provinces')
  @Public()
  @ApiOperation({
    summary: 'List provinces',
    description:
      'No session required — an address form needs this before checkout exists to be logged ' +
      'in for. All 77 provinces; MAX_PAGE_SIZE (50) still applies, so a client wanting every ' +
      'province in one screen may need a second page.',
  })
  @ApiPaginatedResponse(ProvinceDto)
  async listProvinces(@Query() query: ListProvincesQueryDto): Promise<Page<ProvinceDto>> {
    return this.area.listProvinces(query.limit, query.cursor);
  }

  @Get('districts')
  @Public()
  @ApiOperation({
    summary: 'List a province’s districts',
    description: 'provinceId is required — this is a cascading picker, not a browse-everything list.',
  })
  @ApiPaginatedResponse(DistrictDto)
  async listDistricts(@Query() query: ListDistrictsQueryDto): Promise<Page<DistrictDto>> {
    return this.area.listDistricts(query.provinceId, query.limit, query.cursor);
  }

  @Get('subdistricts')
  @Public()
  @ApiOperation({
    summary: 'List a district’s subdistricts, with each one’s postal code(s)',
    description:
      'districtId is required, same reasoning as districts. Each item carries postalCodes ' +
      '(an array — see K7) so picking a subdistrict needs no second call to learn its postal code.',
  })
  @ApiPaginatedResponse(SubdistrictDto)
  async listSubdistricts(@Query() query: ListSubdistrictsQueryDto): Promise<Page<SubdistrictDto>> {
    return this.area.listSubdistricts(query.districtId, query.limit, query.cursor);
  }
}
