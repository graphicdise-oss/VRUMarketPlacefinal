import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { toPage } from '../common/pagination/page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { newId } from '../common/id.js';
import { ArticleDto, ArticlePageDto, ListArticlesQueryDto, CreateArticleDto, UpdateArticleDto } from './dto/article.dto.js';

const LIST_NAME = 'article';

@Injectable()
export class ArticleService {
  constructor(private readonly prisma: PrismaService) { }

  async list(query: ListArticlesQueryDto): Promise<ArticlePageDto> {
    const where: Prisma.ArticleWhereInput = {};
    if (query.category) {
      where.category = query.category;
    }
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const rows = await this.prisma.article.findMany({
      where: {
        ...keysetAfter(query.cursor, LIST_NAME),
        ...where,
      },
      orderBy: newestFirst(),
      take: query.limit + 1,
    });

    const page = toPage(rows, query.limit, LIST_NAME);
    return { ...page, items: page.items.map(row => ArticleDto.from(row)) };
  }

  async getById(id: string): Promise<ArticleDto> {
    const row = await this.prisma.article.findUnique({
      where: { id },
    });
    if (!row) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบบทความ' });
    }
    return ArticleDto.from(row);
  }

  async create(dto: CreateArticleDto): Promise<ArticleDto> {
    const row = await this.prisma.article.create({
      data: {
        id: newId(),
        title: dto.title,
        category: dto.category,
        image: dto.image,
        authorName: dto.authorName,
        excerpt: dto.excerpt,
        content: dto.content,
        tags: dto.tags ? dto.tags : [],
      },
    });
    return ArticleDto.from(row);
  }

  async update(id: string, dto: UpdateArticleDto): Promise<ArticleDto> {
    const existing = await this.prisma.article.findUnique({ where: { id } });
    if (!existing) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบบทความ' });
    }

    const row = await this.prisma.article.update({
      where: { id },
      data: {
        title: dto.title,
        category: dto.category,
        image: dto.image,
        authorName: dto.authorName,
        excerpt: dto.excerpt,
        content: dto.content,
        tags: dto.tags,
      },
    });
    return ArticleDto.from(row);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.article.findUnique({ where: { id } });
    if (!existing) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบบทความ' });
    }

    await this.prisma.article.delete({ where: { id } });
  }
}
