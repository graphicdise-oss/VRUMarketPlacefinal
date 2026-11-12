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
  Req,
  Res,
  UploadedFile,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { readSession } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { AppException } from '../common/errors/app-exception.js';
import { AcceptsUpload } from '../files/accepts-upload.decorator.js';
import { sendPrivateFile } from '../files/send-private-file.js';
import { CreateBannerDto, UpdateBannerDto } from './banner.dto.js';
import { BannerService } from './banner.service.js';

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

  @Get('public/banners/images/:fileId')
  @Public()
  @ApiOperation({ summary: 'Fetch a stored banner image' })
  @ApiParam({ name: 'fileId', format: 'uuid' })
  async readBannerImage(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const viewer = readSession(request)?.user ?? null;
    const { file, restricted } = await this.bannerService.readImage(fileId, viewer);
    if (restricted) {
      sendPrivateFile(response, file);
      return;
    }
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.buffer);
  }

  @Post('admin/banners/upload')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  @AcceptsUpload({ field: 'file', check: () => Promise.resolve() })
  @ApiOperation({ summary: 'Admin: Upload and sanitize a banner image (jpg/png)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async uploadBannerImage(@UploadedFile() file: Express.Multer.File | undefined): Promise<{ url: string }> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }
    return this.bannerService.uploadImage(file);
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
