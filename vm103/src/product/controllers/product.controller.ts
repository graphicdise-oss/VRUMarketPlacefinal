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
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { readSession, type CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CSRF_HEADER } from '../../auth/csrf.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Public } from '../../auth/decorators/public.decorator.js';
import { ReviewDecisionDto } from '../../common/dto/review-decision.dto.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../../common/pagination/page.dto.js';
import type { Page } from '../../common/pagination/page.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { RequiresCommunityAdmin } from '../../community/decorators/requires-community-admin.decorator.js';
import { AcceptsUpload } from '../../files/accepts-upload.decorator.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { MAX_VARIANTS_PER_PRODUCT } from '../common/product-policy.js';
import { CreateProductVariantDto } from '../dto/create-product-variant.dto.js';
import { CreateProductDto } from '../dto/create-product.dto.js';
import { ListPendingProductsQueryDto } from '../dto/list-pending-products-query.dto.js';
import { ListProductsQueryDto } from '../dto/list-products-query.dto.js';
import { ProductDto, PublicProductDto } from '../dto/product.dto.js';
import { RejectProductDto } from '../dto/reject-product.dto.js';
import { SearchProductsQueryDto } from '../dto/search-products-query.dto.js';
import { UpdateProductVariantDto } from '../dto/update-product-variant.dto.js';
import { UpdateProductDto } from '../dto/update-product.dto.js';
import { ProductIdScopeResolver } from '../product-id.scope-resolver.js';
import { ProductAdminService } from '../services/product-admin.service.js';
import { ProductService } from '../services/product.service.js';

/**
 * `Product` (#41 creation/images, #42 publish toggle + the public views, #43 approve/reject).
 * Creation, image management, publish/unpublish, and moderation each need a session; the list,
 * the single-product view, and reading a photo do not — invariant 1 lets anyone browse.
 *
 * `GET /products`, `GET /products/search` and `GET /products/:productId` are the *only* places a
 * stranger ever sees a product (#42's own AC: "มีจุดเดียวที่ตอบว่าสินค้าชิ้นนี้โชว์ได้ไหม") —
 * `search` (#45) reuses the same `PRODUCT_OWN_VISIBILITY_FILTER` + `LIVE_SHOP_FILTER` composition
 * `list()` uses, rather than growing a second route with its own copy of the rule.
 *
 * `pending`, `search`, and `mine` are declared before `:productId`, same reasoning as
 * `ShopController`'s `me`/`pending` — Nest's route matching would otherwise try to parse
 * "pending"/"search"/"mine" as a product id.
 *
 * `PATCH :productId`, the `variants` sub-routes, and the reset now built into the image routes
 * are #44's: invariant 6's two-group edit split (A3/I13) — name/description/category/variant-name/
 * new-variant reset an approved product back to PENDING, stock/price/deleting-a-variant do not.
 *
 * `DELETE :productId` (§78) is L6's whole-product soft delete, cascading to every variant — a
 * gap left over from #41/#44 that only ever wired up per-variant delete.
 */
@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(
    private readonly products: ProductService,
    private readonly productAdmin: ProductAdminService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'List a new product',
    description:
      'The caller’s own approved, non-suspended shop only. Starts PENDING and is not publicly ' +
      'visible until #42/#43 approve it. Images are added afterwards via POST /products/:id/images.',
  })
  @ApiResponse({ status: 201, type: ProductDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Shop not approved, or suspended.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Caller has no shop, or no such category.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async create(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreateProductDto,
  ): Promise<ProductDto> {
    return this.products.create(actor.id, dto);
  }

  @Patch(':productId')
  @ApiOperation({
    summary: 'Edit my product’s name, description, or category',
    description:
      'Full replace, not a partial patch — same shape as every other Update DTO in this project. ' +
      'Invariant 6’s first edit group (A3/I13): always resets moderationStatus to PENDING, which ' +
      'is what makes the product disappear from the public list/page (#42’s own single filter), ' +
      'not a separate unpublish call.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Shop suspended.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product/category, or not mine.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async updateDetails(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDto> {
    return this.products.updateDetails(actor.id, productId, dto);
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my product',
    description:
      'Code review (2026-09-22, §78): L6 says a product delete is soft, cascading to every ' +
      'variant, and no endpoint for it existed anywhere in this module before this fix — only ' +
      'per-variant delete (#44) did. Disappears from the shop’s own page and search immediately ' +
      '(deletedAt is part of every visibility filter); the row and its variants stay for reviews, ' +
      'stats, and dispute evidence to keep resolving.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Shop suspended or closed.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product, not mine, or already deleted.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async remove(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.products.remove(actor.id, productId);
  }

  @Post(':productId/variants')
  @ApiOperation({
    summary: 'Add a new variant to my product',
    description: 'Invariant 6’s first edit group (A3/I13): a new variant always resets moderationStatus to PENDING.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ProductDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: `Already at ${MAX_VARIANTS_PER_PRODUCT} variants.` })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async addVariant(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateProductVariantDto,
  ): Promise<ProductDto> {
    return this.products.addVariant(actor.id, productId, dto);
  }

  @Patch(':productId/variants/:variantId')
  @ApiOperation({
    summary: 'Edit one of my product’s variants',
    description:
      '⚠️ The point most likely to be gotten wrong in this whole project: name and price/stock ' +
      'sit on the same row but belong to different invariant-6 groups (I13). A changed name ' +
      'resets moderationStatus to PENDING; a price/stock-only change never does.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product/variant, or not mine.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async updateVariant(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateProductVariantDto,
  ): Promise<ProductDto> {
    return this.products.updateVariant(actor.id, productId, variantId, dto);
  }

  @Delete(':productId/variants/:variantId')
  @ApiOperation({
    summary: 'Remove one of my product’s variants',
    description:
      'Soft delete (L6) — invariant 6’s second edit group, takes effect immediately, no ' +
      're-review. Refuses to delete the product’s last live variant.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'variantId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product/variant, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'This is the product’s last live variant.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async removeVariant(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ): Promise<ProductDto> {
    return this.products.removeVariant(actor.id, productId, variantId);
  }

  @Post(':productId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Show my product publicly again',
    description: 'Invariant 6’s first visibility layer — independent of admin moderation (#42).',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already published.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async publish(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductDto> {
    return this.products.publish(actor.id, productId);
  }

  @Post(':productId/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hide my product from the public list and page',
    description: 'The product row is untouched — this only sets shopPublishStatus (#42).',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already unpublished.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async unpublish(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductDto> {
    return this.products.unpublish(actor.id, productId);
  }

  @Post(':productId/approve')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ProductIdScopeResolver)
  @ApiOperation({
    summary: 'Approve a pending product',
    description:
      'The two-tier guard (#32), through the product’s shop’s community. The shop’s own owner ' +
      'may not approve it, even if they also administer that community (N28). Recorded in ' +
      'audit_log.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this product’s community admin, not a super admin, or the product’s own shop owner.',
  })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'CONFLICT — already decided. STALE_VIEW — edited since the reviewer opened it (§91): reload and decide again.',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async approve(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<ProductDto> {
    return this.productAdmin.approve(actor.id, productId, dto.reviewRevision);
  }

  @Post(':productId/reject')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ProductIdScopeResolver)
  @ApiOperation({
    summary: 'Reject a pending product, or take down an approved one',
    description:
      'H4: category is NEEDS_FIX (an order in flight is unaffected) or PROHIBITED (topics 7/10 ' +
      'cancel-and-refund an unpaid order, or freeze a paid one). Same guard and self-approval ' +
      'rule as approving. Recorded in audit_log with both the category and the reason. §109: an ' +
      'APPROVED product may be rejected too — its revision comes from GET /products/:id/admin.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Missing category, or the reason is too short.' })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this product’s community admin, not a super admin, or the product’s own shop owner.',
  })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'CONFLICT — already decided. STALE_VIEW — edited since the reviewer opened it (§91): reload and decide again.',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async reject(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: RejectProductDto,
  ): Promise<ProductDto> {
    return this.productAdmin.reject(actor.id, productId, dto);
  }

  @Get(':productId/admin')
  @RequiresCommunityAdmin(ProductIdScopeResolver)
  @ApiOperation({
    summary: 'View a product as its community admin',
    description:
      '§109: any moderation status, with the reviewRevision a decision must carry — what a reviewer ' +
      'reads before taking down a live product. Only an admin of the product’s shop’s community, or ' +
      'a super admin; anyone else, and a product id that does not exist, answer the same 403.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not this product’s community admin, not a super admin, or no such product.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'The product was deleted by its shop.' })
  @ApiCookieAuth('access_token')
  async viewAsAdmin(@Param('productId', ParseUUIDPipe) productId: string): Promise<ProductDto> {
    return this.productAdmin.findAdmin(productId);
  }

  @Get('pending')
  @ApiOperation({
    summary: 'List pending products I may review',
    description:
      'Scoped to the caller automatically: every community for a super admin, or only the ' +
      'communities the caller administers (#32) — a signed-in caller who administers nothing ' +
      'gets an empty page, not a 403.',
  })
  @ApiPaginatedResponse(ProductDto)
  @ApiCookieAuth('access_token')
  async pending(
    @CurrentUser() actor: CurrentUserType,
    @Query() query: ListPendingProductsQueryDto,
  ): Promise<Page<ProductDto>> {
    return this.productAdmin.pending(actor.id, actor.role, query.limit, query.cursor);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'List my own products, across every moderation status',
    description:
      'Code review (2026-09-22, §78): the only way to read a PENDING or REJECTED product’s ' +
      'rejectionCategory/rejectionReason back — GET /products/:productId (invariant 1’s public ' +
      'view) only ever answers for an APPROVED, published product, so before this route a seller ' +
      'had no way to see why their own listing was rejected. No requireShopMaySell gate: reading ' +
      'your own catalogue is not "selling", so a suspended or closed shop’s owner can still see it.',
  })
  @ApiPaginatedResponse(ProductDto)
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Caller has no shop.' })
  @ApiCookieAuth('access_token')
  async mine(
    @CurrentUser() actor: CurrentUserType,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<ProductDto>> {
    return this.products.listMine(actor.id, query.limit, query.cursor);
  }

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Search products by Thai (or any) product name',
    description:
      'No session required (invariant 1). Trigram matching (`pg_trgm`, N5) — a plain substring ' +
      'match plus one typo’s worth of tolerance, since PostgreSQL has no Thai text-search ' +
      'configuration. Same three visibility layers as GET /products (#42) — a pending, rejected, ' +
      'unpublished, or soft-deleted product never appears here either. Optionally filtered by ' +
      'communityId (L8). No relevance ranking beyond newest-first: there is no ts_rank to weight ' +
      'a name match over a description match, so this does not try to.',
  })
  @ApiPaginatedResponse(PublicProductDto)
  async search(@Query() query: SearchProductsQueryDto): Promise<Page<PublicProductDto>> {
    return this.products.search(query);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List products',
    description:
      'No session required (invariant 1). Only products that pass all three visibility layers ' +
      '(#42) — a pending, rejected, unpublished, or soft-deleted product never appears here, and ' +
      'neither does one whose shop is unapproved, closed, suspended, or owned by a banned account ' +
      '(§92). Optionally filtered by ' +
      'communityId (L8); omit it to see every community’s products.',
  })
  @ApiPaginatedResponse(PublicProductDto)
  async list(@Query() query: ListProductsQueryDto): Promise<Page<PublicProductDto>> {
    return this.products.list(query);
  }

  @Get(':productId')
  @Public()
  @ApiOperation({
    summary: 'View a product',
    description:
      'No session required. Gated on the product’s own two visibility layers only — a product ' +
      'whose shop has since closed or been suspended still answers 200, with shopClosedAt/ ' +
      'shopSuspendedAt set, rather than 404 (I14): show a badge instead of breaking an old order ' +
      'page that links here. A banned owner reads as shopSuspendedAt too (§92), on purpose.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 200, type: PublicProductDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async viewPublic(@Param('productId', ParseUUIDPipe) productId: string): Promise<PublicProductDto> {
    return this.products.findPublic(productId);
  }

  @Post(':productId/images')
  @HttpCode(HttpStatus.OK)
  @AcceptsUpload({ field: 'file', check: (s, userId, p) => s.get(ProductService, { strict: false }).requireImageSlot(userId, p.productId!) })
  @ApiOperation({
    summary: 'Add a photo to my product',
    description: `jpg/png only, re-encoded to strip EXIF, up to 10 per product (C4) — uses #36's shared file helper.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not a real jpg/png, or no file sent.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product, or not mine.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already at 10 images.' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'File too large.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async addImage(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ProductDto> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.products.addImage(actor.id, productId, file);
  }

  @Delete(':productId/images/:imageId')
  @ApiOperation({ summary: 'Remove one of my product’s photos' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'imageId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProductDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such product/image, or not mine.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async removeImage(
    @CurrentUser() actor: CurrentUserType,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<ProductDto> {
    return this.products.removeImage(actor.id, productId, imageId);
  }

  @Get(':productId/images/:imageId')
  @Public()
  @ApiOperation({
    summary: 'Fetch a product photo',
    description:
      'Public — no session required — for a photo an approval of its product has covered. Two exceptions ' +
      'answer 404 to everyone but the shop’s owner and the admins who may review it (sent to them as ' +
      '`Cache-Control: private, no-store`): a product ruled PROHIBITED (§103), and a photo nobody has ' +
      'reviewed yet (§109). A photo approved once stays public while its product is re-reviewed.',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiParam({ name: 'imageId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The image bytes, Content-Type set to image/jpeg or image/png.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async readImage(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // §103: public, but the session (if any) decides whether a PROHIBITED product's photo is shown.
    const viewer = readSession(request)?.user ?? null;
    const { file, restricted } = await this.products.readImage(productId, imageId, viewer);
    if (restricted) {
      sendPrivateFile(response, file);
      return;
    }
    response.setHeader('Content-Type', file.contentType);
    response.send(file.buffer);
  }
}
