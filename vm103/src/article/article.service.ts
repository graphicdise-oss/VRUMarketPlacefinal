import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { CurrentUser } from '../auth/authenticated-request.js';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { keysetAfter, newestFirst } from '../common/pagination/keyset.js';
import { toPage } from '../common/pagination/page.js';
import { FileStorageService, type ReadImage, type UploadedTempFile } from '../files/file-storage.service.js';
import { UNATTACHED_UPLOADED_FILE_WHERE } from '../files/unattached-uploaded-file-filter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ArticleDto, ArticlePageDto, CreateArticleDto, ListArticlesQueryDto, UpdateArticleDto } from './dto/article.dto.js';
import { sanitizeArticleHtml } from './sanitize-article-html.js';

const LIST_NAME = 'article';
const ARTICLE_IMAGE_SUFFIX_PREFIX = '/articles/images/';
const ARTICLE_IMAGE_URL_REGEX = /\/articles\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function extractArticleFileId(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) {
    return null;
  }
  const match = ARTICLE_IMAGE_URL_REGEX.exec(imageUrl.trim());
  return match?.[1] ?? null;
}

@Injectable()
export class ArticleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
  ) {}

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

  async uploadImage(upload: UploadedTempFile): Promise<{ url: string }> {
    const stored = await this.files.storeImage(upload);
    return { url: `/api/v1/articles/images/${stored.id}` };
  }

  async readImage(fileId: string, viewer: CurrentUser | null): Promise<{ file: ReadImage; restricted: boolean }> {
    const unattached = await this.prisma.uploadedFile.findFirst({
      where: { id: fileId, ...UNATTACHED_UPLOADED_FILE_WHERE },
      select: { id: true },
    });
    if (!unattached) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบรูปภาพบทความ' });
    }

    const suffix = `${ARTICLE_IMAGE_SUFFIX_PREFIX}${fileId}`;
    const referencedArticle = await this.prisma.article.findFirst({
      where: { image: { endsWith: suffix } },
      select: { id: true },
    });

    const isSuperAdmin = viewer?.role === UserRole.SUPER_ADMIN;
    if (!referencedArticle && !isSuperAdmin) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบรูปภาพบทความ' });
    }

    const file = await this.files.readImage(fileId);
    if (!file) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบรูปภาพบทความ' });
    }

    return { file, restricted: referencedArticle === null };
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
        content: sanitizeArticleHtml(dto.content),
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
        content: dto.content !== undefined ? sanitizeArticleHtml(dto.content) : undefined,
        tags: dto.tags,
      },
    });
    if (dto.image !== undefined && dto.image !== existing.image) {
      await this.cleanupOrphanArticleImage(existing.image);
    }
    return ArticleDto.from(row);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.article.findUnique({ where: { id } });
    if (!existing) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบบทความ' });
    }

    await this.prisma.article.delete({ where: { id } });
    await this.cleanupOrphanArticleImage(existing.image);
  }

  private async cleanupOrphanArticleImage(imageUrl: string | null | undefined): Promise<void> {
    const fileId = extractArticleFileId(imageUrl);
    if (!fileId) {
      return;
    }
    const suffix = `${ARTICLE_IMAGE_SUFFIX_PREFIX}${fileId}`;
    const remaining = await this.prisma.article.count({
      where: { image: { endsWith: suffix } },
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
