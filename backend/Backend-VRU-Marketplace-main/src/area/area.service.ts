import { Injectable } from '@nestjs/common';
import { keysetBefore, oldestFirst } from '../common/pagination/keyset.js';
import { Page, toPage } from '../common/pagination/page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DistrictDto } from './dto/district.dto.js';
import { ProvinceDto } from './dto/province.dto.js';
import { SubdistrictDto } from './dto/subdistrict.dto.js';

const PROVINCE_LIST_NAME = 'provinces';
const DISTRICT_LIST_NAME = 'districts';
const SUBDISTRICT_LIST_NAME = 'subdistricts';

/**
 * The province → district → subdistrict reference data #46 seeds (see
 * prisma/reference-data/thai-geography for provenance). Read-only: there is no create, update or
 * delete anywhere in this module, because there is no endpoint for any of them — this is
 * reference data an address form calls, not a resource a user or admin manages.
 *
 * No guard on any of these three methods: invariant-1-style reasoning applies even though this
 * predates community — filling in an address needs no session, and #47's checkout flow calls
 * this before there is anything to be logged in *as* yet in some flows (browsing then checking
 * out for the first time).
 *
 * §80: all three list oldest-first (`source_code` ascending), not the system's usual newest-first.
 * `generate-migration-sql.ts` inserts rows in the source file's own order, so id and `source_code`
 * rise together — `ORDER BY id DESC` therefore read this data *backwards*: บึงกาฬ (source_code 77)
 * first, กรุงเทพมหานคร (source_code 1) last, landing on page 4 of the default page size. Reference
 * data has no "newest" to prioritise the way a user's own list does, so there is no reason to pay
 * that reversal — oldest-first recovers the source ordering everyone editing the seed data already
 * reads it in.
 */
@Injectable()
export class AreaService {
  constructor(private readonly prisma: PrismaService) {}

  async listProvinces(limit: number, cursor: string | undefined): Promise<Page<ProvinceDto>> {
    const rows = await this.prisma.province.findMany({
      where: { ...keysetBefore(cursor, PROVINCE_LIST_NAME) },
      orderBy: oldestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, PROVINCE_LIST_NAME);

    return { ...page, items: page.items.map((row) => ProvinceDto.from(row)) };
  }

  async listDistricts(
    provinceId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<DistrictDto>> {
    const rows = await this.prisma.district.findMany({
      where: { ...keysetBefore(cursor, DISTRICT_LIST_NAME), provinceId },
      orderBy: oldestFirst(),
      take: limit + 1,
    });

    const page = toPage(rows, limit, DISTRICT_LIST_NAME);

    return { ...page, items: page.items.map((row) => DistrictDto.from(row)) };
  }

  async listSubdistricts(
    districtId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<SubdistrictDto>> {
    const rows = await this.prisma.subdistrict.findMany({
      where: { ...keysetBefore(cursor, SUBDISTRICT_LIST_NAME), districtId },
      orderBy: oldestFirst(),
      take: limit + 1,
      include: { postalCodes: { select: { id: true, postalCode: true } } },
    });

    const page = toPage(rows, limit, SUBDISTRICT_LIST_NAME);

    return { ...page, items: page.items.map((row) => SubdistrictDto.from(row)) };
  }
}
