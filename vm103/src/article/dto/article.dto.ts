import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Article } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Page } from '../../common/pagination/page.js';

export class ArticleDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'จากเส้นใยสู่ผืนผ้า' })
  title!: string;

  @ApiProperty({ example: 'ภูมิปัญญา' })
  category!: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/...' })
  image!: string | null;

  @ApiProperty({ example: 'ชุมชนบ้านนา' })
  authorName!: string;

  @ApiPropertyOptional({ example: 'เรียนรู้กระบวนการทอผ้า...' })
  excerpt!: string | null;

  @ApiProperty({ example: '<p>เนื้อหาบทความ...</p>' })
  content!: string;

  @ApiProperty({ type: [String], example: ['หัตถกรรม', 'ผ้าทอมือ'] })
  tags!: string[];

  @ApiProperty({ example: '2026-10-06T00:00:00.000Z' })
  createdAt!: Date;

  static from(row: Article): ArticleDto {
    const dto = new ArticleDto();
    dto.id = row.id;
    dto.title = row.title;
    dto.category = row.category;
    dto.image = row.image;
    dto.authorName = row.authorName;
    dto.excerpt = row.excerpt;
    dto.content = row.content;
    dto.tags = Array.isArray(row.tags) ? (row.tags as string[]) : [];
    dto.createdAt = row.createdAt;
    return dto;
  }
}

export class ListArticlesQueryDto {
  @ApiPropertyOptional({ description: 'Category to filter by' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Search term for title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Number of articles to return', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Cursor for pagination' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class ArticlePageDto implements Page<ArticleDto> {
  @ApiProperty({ type: [ArticleDto] })
  items!: ArticleDto[];

  @ApiPropertyOptional({ description: 'Cursor to fetch the next page', nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Whether there are more items to fetch' })
  hasMore!: boolean;
}

export class CreateArticleDto {
  @ApiProperty({ example: 'จากเส้นใยสู่ผืนผ้า' })
  @IsString()
  title!: string;

  @ApiProperty({ example: 'ภูมิปัญญา' })
  @IsString()
  category!: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/...' })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiProperty({ example: 'ชุมชนบ้านนา' })
  @IsString()
  authorName!: string;

  @ApiPropertyOptional({ example: 'เรียนรู้กระบวนการทอผ้า...' })
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiProperty({ example: '<p>เนื้อหาบทความ...</p>' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ type: [String], example: ['หัตถกรรม', 'ผ้าทอมือ'] })
  @IsOptional()
  tags?: string[];
}

import { PartialType } from '@nestjs/swagger';

export class UpdateArticleDto extends PartialType(CreateArticleDto) {}
