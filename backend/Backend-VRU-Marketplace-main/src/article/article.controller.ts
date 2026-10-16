import { Controller, Get, Param, Query, Post, Body, Patch, Delete } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ArticleService } from './article.service.js';
import { ArticleDto, ArticlePageDto, ListArticlesQueryDto, CreateArticleDto, UpdateArticleDto } from './dto/article.dto.js';

@ApiTags('articles')
@Controller('articles')
export class ArticleController {
  constructor(private readonly service: ArticleService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List articles' })
  @ApiResponse({ status: 200, type: ArticlePageDto })
  async list(@Query() query: ListArticlesQueryDto): Promise<ArticlePageDto> {
    return this.service.list(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get an article by ID' })
  @ApiResponse({ status: 200, type: ArticleDto })
  async getById(@Param('id') id: string): Promise<ArticleDto> {
    return this.service.getById(id);
  }

  @RequiresSuperAdmin()
  @Post()
  @ApiOperation({ summary: 'Admin: Create a new article' })
  @ApiResponse({ status: 201, type: ArticleDto })
  async create(@Body() dto: CreateArticleDto): Promise<ArticleDto> {
    return this.service.create(dto);
  }

  @RequiresSuperAdmin()
  @Patch(':id')
  @ApiOperation({ summary: 'Admin: Update an existing article' })
  @ApiResponse({ status: 200, type: ArticleDto })
  async update(@Param('id') id: string, @Body() dto: UpdateArticleDto): Promise<ArticleDto> {
    return this.service.update(id, dto);
  }

  @RequiresSuperAdmin()
  @Delete(':id')
  @ApiOperation({ summary: 'Admin: Delete an article' })
  @ApiResponse({ status: 200, description: 'Article deleted successfully' })
  async delete(@Param('id') id: string): Promise<void> {
    return this.service.delete(id);
  }
}
