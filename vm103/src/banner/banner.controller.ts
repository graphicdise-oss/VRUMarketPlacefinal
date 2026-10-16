import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BannerService } from './banner.service.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { CreateBannerDto, UpdateBannerDto } from './banner.dto.js';

@ApiTags('banners')
@Controller()
export class BannerController {
  constructor(private readonly bannerService: BannerService) {}

  @Get('public/banners')
  @Public()
  @ApiOperation({ summary: 'Get all active banners for homepage' })
  getPublicBanners() {
    return this.bannerService.getPublicBanners();
  }

  @Get('admin/banners')
  @RequiresSuperAdmin()
  @ApiOperation({ summary: 'Admin: Get all banners' })
  getAdminBanners() {
    return this.bannerService.getAllBanners();
  }

  @Post('admin/banners')
  @RequiresSuperAdmin()
  @ApiOperation({ summary: 'Admin: Create a new banner' })
  createBanner(@Body() dto: CreateBannerDto) {
    return this.bannerService.createBanner(dto);
  }

  @Patch('admin/banners/:id')
  @RequiresSuperAdmin()
  @ApiOperation({ summary: 'Admin: Update an existing banner' })
  updateBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.bannerService.updateBanner(id, dto);
  }

  @Delete('admin/banners/:id')
  @RequiresSuperAdmin()
  @ApiOperation({ summary: 'Admin: Delete a banner' })
  deleteBanner(@Param('id') id: string) {
    return this.bannerService.deleteBanner(id);
  }
}
