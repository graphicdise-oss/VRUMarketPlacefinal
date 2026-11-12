import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { CurrentUser } from '../auth/authenticated-request.js';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { FileStorageService, type ReadImage, type UploadedTempFile } from '../files/file-storage.service.js';
import { UNATTACHED_UPLOADED_FILE_WHERE } from '../files/unattached-uploaded-file-filter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBannerDto, UpdateBannerDto } from './banner.dto.js';

const BANNER_IMAGE_SUFFIX_PREFIX = '/public/banners/images/';
const BANNER_IMAGE_URL_REGEX = /\/public\/banners\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function extractBannerFileId(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) {
    return null;
  }
  const match = BANNER_IMAGE_URL_REGEX.exec(imageUrl.trim());
  return match?.[1] ?? null;
}

@Injectable()
export class BannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
  ) {}

  async getPublicBanners() {
    const items = await this.prisma.banner.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
    return { items };
  }

  async getAllBanners() {
    const items = await this.prisma.banner.findMany({
      orderBy: { displayOrder: 'asc' },
    });
    return { items };
  }

  async uploadImage(upload: UploadedTempFile): Promise<{ url: string }> {
    const stored = await this.files.storeImage(upload);
    return { url: `/api/v1/public/banners/images/${stored.id}` };
  }

  async readImage(fileId: string, viewer: CurrentUser | null): Promise<{ file: ReadImage; restricted: boolean }> {
    const unattached = await this.prisma.uploadedFile.findFirst({
      where: { id: fileId, ...UNATTACHED_UPLOADED_FILE_WHERE },
      select: { id: true },
    });
    if (!unattached) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบรูปภาพแบนเนอร์' });
    }

    const suffix = `${BANNER_IMAGE_SUFFIX_PREFIX}${fileId}`;
    const activeBanner = await this.prisma.banner.findFirst({
      where: { isActive: true, imageUrl: { endsWith: suffix } },
      select: { id: true },
    });

    const isSuperAdmin = viewer?.role === UserRole.SUPER_ADMIN;
    if (!activeBanner && !isSuperAdmin) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบรูปภาพแบนเนอร์' });
    }

    const file = await this.files.readImage(fileId);
    if (!file) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบรูปภาพแบนเนอร์' });
    }

    return { file, restricted: activeBanner === null };
  }

  async createBanner(dto: CreateBannerDto) {
    const banner = await this.prisma.banner.create({
      data: {
        id: newId(),
        ...dto,
      },
    });
    return banner;
  }

  async updateBanner(id: string, dto: UpdateBannerDto) {
    const exists = await this.prisma.banner.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('Banner not found');
    }
    const banner = await this.prisma.banner.update({
      where: { id },
      data: dto,
    });
    if (dto.imageUrl !== undefined && dto.imageUrl !== exists.imageUrl) {
      await this.cleanupOrphanBannerImage(exists.imageUrl);
    }
    return banner;
  }

  async deleteBanner(id: string) {
    const exists = await this.prisma.banner.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('Banner not found');
    }
    await this.prisma.banner.delete({ where: { id } });
    await this.cleanupOrphanBannerImage(exists.imageUrl);
    return { success: true };
  }

  private async cleanupOrphanBannerImage(imageUrl: string | null | undefined): Promise<void> {
    const fileId = extractBannerFileId(imageUrl);
    if (!fileId) {
      return;
    }
    const suffix = `${BANNER_IMAGE_SUFFIX_PREFIX}${fileId}`;
    const remaining = await this.prisma.banner.count({
      where: { imageUrl: { endsWith: suffix } },
    });
    if (remaining > 0) {
      return;
    }
    const unattached = await this.prisma.uploadedFile.findFirst({
      where: { id: fileId, ...UNATTACHED_UPLOADED_FILE_WHERE },
      select: { id: true },
    });
    if (unattached) {
      await this.files.discardUnattached(fileId);
    }
  }
}
