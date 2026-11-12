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
  Query,
  Req,
  Res,
  UploadedFile,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { readSession } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { AppException } from '../common/errors/app-exception.js';
import { AcceptsUpload } from '../files/accepts-upload.decorator.js';
import { sendPrivateFile } from '../files/send-private-file.js';
import { ArticleService } from './article.service.js';
import { ArticleDto, ArticlePageDto, CreateArticleDto, ListArticlesQueryDto, UpdateArticleDto } from './dto/article.dto.js';

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
  @Get('images/:fileId')
  @ApiOperation({ summary: 'Fetch a stored article cover image' })
  @ApiParam({ name: 'fileId', format: 'uuid' })
  async readArticleImage(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const viewer = readSession(request)?.user ?? null;
    const { file, restricted } = await this.service.readImage(fileId, viewer);
    if (restricted) {
      sendPrivateFile(response, file);
      return;
    }
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.buffer);
  }

  @RequiresSuperAdmin()
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @AcceptsUpload({ field: 'file', check: () => Promise.resolve() })
  @ApiOperation({ summary: 'Admin: Upload and sanitize an article cover image (jpg/png)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async uploadArticleImage(@UploadedFile() file: Express.Multer.File | undefined): Promise<{ url: string }> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }
    return this.service.uploadImage(file);
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
