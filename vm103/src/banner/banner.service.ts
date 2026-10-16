import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { newId } from '../common/id.js';
import { CreateBannerDto, UpdateBannerDto } from './banner.dto.js';

@Injectable()
export class BannerService {
  constructor(private readonly prisma: PrismaService) {}

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
    return banner;
  }

  async deleteBanner(id: string) {
    const exists = await this.prisma.banner.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('Banner not found');
    }
    await this.prisma.banner.delete({ where: { id } });
    return { success: true };
  }
}
