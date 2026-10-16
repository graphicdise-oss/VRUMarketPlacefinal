import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { newId } from '../common/id.js';
import { ProductDto } from '../product/dto/product.dto.js';

@Injectable()
export class FavoriteService {
  constructor(private readonly db: PrismaService) {}

  async list(userId: string): Promise<ProductDto[]> {
    const favorites = await this.db.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          include: {
            variants: true,
            images: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    return favorites.map((f) => ProductDto.from(f.product));
  }

  async add(userId: string, productId: string): Promise<void> {
    const existing = await this.db.favorite.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (!existing) {
      await this.db.favorite.create({
        data: { id: newId(), userId, productId },
      });
    }
  }

  async remove(userId: string, productId: string): Promise<void> {
    await this.db.favorite.deleteMany({
      where: { userId, productId },
    });
  }
}
