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
import { RequiresVerifiedEmail } from '../../auth/decorators/requires-verified-email.decorator.js';
import { ReviewDecisionDto } from '../../common/dto/review-decision.dto.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../../common/pagination/page.dto.js';
import type { Page } from '../../common/pagination/page.js';
import { RefusesAdmins } from '../../community/decorators/refuses-admins.decorator.js';
import { RequiresCommunityAdmin } from '../../community/decorators/requires-community-admin.decorator.js';
import { AcceptsUpload } from '../../files/accepts-upload.decorator.js';
import { sendPrivateFile } from '../../files/send-private-file.js';
import { ApplyShopDto } from '../dto/apply-shop.dto.js';
import { ListPendingShopsQueryDto } from '../dto/list-pending-shops-query.dto.js';
import { ListShopsQueryDto } from '../dto/list-shops-query.dto.js';
import { MyShopDto } from '../dto/my-shop.dto.js';
import { RejectShopDto } from '../dto/reject-shop.dto.js';
import { ShopAdminDto } from '../dto/shop-admin.dto.js';
import { ShopProfileChangeDto } from '../dto/shop-profile-change.dto.js';
import { ShopDto } from '../dto/shop.dto.js';
import { SuspendShopDto } from '../dto/suspend-shop.dto.js';
import { UpdateShopDto } from '../dto/update-shop.dto.js';
import { ShopAdminService } from '../services/shop-admin.service.js';
import { ShopService } from '../services/shop.service.js';
import { ShopIdScopeResolver } from '../shop-id.scope-resolver.js';

/**
 * `Shop` (#34's application + public list, #35's approve/reject, #37's close, #38's
 * suspend/unsuspend, on top of #32's minimal scaffold). Different audiences for different routes:
 *
 *   - `POST  /shops`                 — apply, gated by B0.1's one verified-email door (#25)
 *   - `GET   /shops/me`              — the owner's own status, the only view showing PENDING/REJECTED
 *   - `PATCH /shops/me`              — the owner's own name/description edit (#73; waits for review once approved, §86)
 *   - `POST  /shops/me/logo`         — the owner's own storefront photo upload (#73; same, §86)
 *   - `GET   /shops/me/pending-logo` — the owner's own look at a logo still waiting for review (§86)
 *   - `GET   /shops/pending`         — applications the caller (a community admin, or super admin) may review
 *   - `GET   /shops/pending-profile-changes` — waiting profile changes the caller may review (§86)
 *   - `GET   /shops/:id/pending-logo` — same guard as approve; the waiting logo, served private (§86)
 *   - `POST  /shops/:id/profile-change/approve|reject` — same guard; decides the waiting change (§86)
 *   - `POST  /shops/:id/approve`     — the two-tier guard's first real user (#32), #35
 *   - `POST  /shops/:id/reject`      — same guard, same self-approval rule
 *   - `POST  /shops/:id/suspend`     — same guard again, #38; no new sales, orders still work
 *   - `POST  /shops/:id/unsuspend`   — same guard, same self-suspension rule
 *   - `POST  /shops/:id/close`       — the owner's own action (#37), not guarded by #32 at all
 *   - `GET   /shops`                 — the public list (invariant 1); `LIVE_SHOP_FILTER` decides who's on it
 *   - `GET   /shops/:id`             — the public single view — approved is enough; closed/suspended stay reachable
 *   - `GET   /shops/:id/logo`        — the public storefront photo read (#73), no session required
 *   - `GET   /shops/:id/admin`       — the two-tier guard's read view (#32), unfiltered by status
 *
 * `me`, `pending` and `pending-profile-changes` are declared before `:shopId` so Nest's route matching does not try to
 * parse them as a shop id — order matters here, the same way it matters for `APP_GUARD`
 * registration elsewhere. The `:shopId/<verb>` routes do not have this problem: they are POST,
 * and have one more path segment than the GET `:shopId` routes.
 */
@ApiTags('shops')
@Controller('shops')
export class ShopController {
  constructor(
    private readonly shops: ShopService,
    private readonly shopAdmin: ShopAdminService
  ) {}

  @Post()
  @RequiresVerifiedEmail()
  @RefusesAdmins()
  @ApiOperation({
    summary: 'Apply to open a shop',
    description:
      'Requires a verified email (B0.1, #25’s one gate). Answers with the new shop in ' +
      'PENDING status. One open shop per person, platform-wide (B2) — applying while you ' +
      'already have one open answers 409, enforced at the database by a partial unique index. ' +
      'Refused (403) for any community admin or super admin — admin accounts never run a shop (§85, N29).',
  })
  @ApiResponse({ status: 201, type: MyShopDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Email not verified, or the caller is a community admin / super admin (N29).' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such community.' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already have an open shop.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async apply(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: ApplyShopDto,
  ): Promise<MyShopDto> {
    return this.shops.apply(actor.id, dto.communityId, dto.name);
  }

  @Get('me')
  @ApiOperation({
    summary: 'View my own shop',
    description:
      'The only view that shows a PENDING or REJECTED shop — everyone else’s view ' +
      'of a shop only ever shows one that is APPROVED.',
  })
  @ApiResponse({ status: 200, type: MyShopDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No open shop.' })
  @ApiCookieAuth('access_token')
  async mine(@CurrentUser() actor: CurrentUserType): Promise<MyShopDto> {
    return this.shops.mine(actor.id);
  }

  @Patch('me')
  @RefusesAdmins() // §87 (N29): an admin runs no shop — an old closed one included
  @ApiOperation({
    summary: 'Edit my own shop’s name and description',
    description:
      'Full replace (#73) — send both fields every time, same convention as the payment-channel ' +
      'and product edit endpoints. A shop not yet approved takes the change directly. An approved ' +
      'shop keeps showing its current name/description: the change lands in pendingName/' +
      'pendingDescription for a community admin to approve or reject (§86), and a second edit ' +
      'before then replaces the first. The shop stays listed and selling while it waits.',
  })
  @ApiResponse({ status: 200, type: MyShopDto })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'The account was erased while the request was in flight.',
  })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Caller has no shop.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'The caller is a community admin / super admin (§87, N29).' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'The shop was approved and has since closed — nothing to edit (§86).',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async updateProfile(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: UpdateShopDto,
  ): Promise<MyShopDto> {
    return this.shops.updateProfile(actor.id, dto);
  }

  @Post('me/logo')
  @RefusesAdmins() // §87 (N29), same as PATCH /shops/me
  @HttpCode(HttpStatus.OK)
  @AcceptsUpload({ field: 'file', check: (s, userId) => s.get(ShopService, { strict: false }).findOwnShopRow(userId) })
  @ApiOperation({
    summary: 'Upload (or replace) my shop’s storefront photo',
    description:
      'jpg/png only, re-encoded to strip EXIF (K1) — uses #36’s shared file helper, same as a ' +
      'product photo or a payment channel’s QR image. Same review rule as PATCH /shops/me (§86): ' +
      'live at once on a shop not yet approved, otherwise the pending logo (hasPendingLogo, viewable ' +
      'at GET /shops/me/pending-logo) until a community admin decides. The file it replaces is deleted.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 200, type: MyShopDto })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'Not a real jpg/png, or no file sent.',
  })
  @ApiResponse({
    status: 401,
    type: ErrorResponseDto,
    description: 'The account was erased while the request was in flight.',
  })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Caller has no shop.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'The caller is a community admin / super admin (§87, N29).' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'The shop was approved and has since closed (§86).',
  })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'File too large.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async setLogo(
    @CurrentUser() actor: CurrentUserType,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<MyShopDto> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.shops.setLogo(actor.id, file);
  }

  @Post('me/banner')
  @RefusesAdmins()
  @HttpCode(HttpStatus.OK)
  @AcceptsUpload({ field: 'file', check: (s, userId) => s.get(ShopService, { strict: false }).findOwnShopRow(userId) })
  @ApiOperation({
    summary: 'Upload (or replace) my shop’s banner / cover photo',
    description: 'jpg/png only, stores the shop banner. The file it replaces is deleted.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 200, type: MyShopDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not a real jpg/png, or no file sent.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'Caller has no shop.' })
  @ApiResponse({ status: 413, type: ErrorResponseDto, description: 'File too large.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async setBanner(
    @CurrentUser() actor: CurrentUserType,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<MyShopDto> {
    if (file === undefined) {
      throw new AppException('VALIDATION_FAILED', { message: 'ไม่มีไฟล์แนบมา' });
    }

    return this.shops.setBanner(actor.id, file);
  }

  @Delete('me/banner')
  @RefusesAdmins()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete my shop’s banner / cover photo',
  })
  @ApiResponse({ status: 200, type: MyShopDto })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async deleteBanner(@CurrentUser() actor: CurrentUserType): Promise<MyShopDto> {
    return this.shops.deleteBanner(actor.id);
  }

  @Get('me/pending-logo')
  @ApiOperation({
    summary: 'Fetch my shop’s logo that is still waiting for review',
    description:
      'Owner only, served private (no shared cache) — nobody else has approved it yet (§86).',
  })
  @ApiResponse({
    status: 200,
    description: 'The image bytes, Content-Type set to image/jpeg or image/png.',
  })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No shop, or no logo waiting.' })
  @ApiCookieAuth('access_token')
  async readMyPendingLogo(
    @CurrentUser() actor: CurrentUserType,
    @Res() response: Response,
  ): Promise<void> {
    sendPrivateFile(response, await this.shops.readMyPendingLogo(actor.id));
  }

  @Post(':shopId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close my own shop',
    description:
      'Soft delete (#37) — orders and reviews keep referencing this row, and its direct link ' +
      'stays reachable (see GET /shops/:id). Not gated by CommunityScopeGuard: this is the ' +
      'owner’s own action, not an admin one. Refuses with 409 while any order still needs the ' +
      'shop’s own action (I11 · J1, #39) — see the 409 response below for the shape.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: MyShopDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not this shop’s owner.' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No such shop.' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description:
      'Already closed, or currently suspended (a suspended shop cannot close itself, J2), or ' +
      'orders still need the shop’s own action (#39) — for that last case, `fieldErrors` is ' +
      'keyed by each blocking order’s id (not a form field name) with a short reason, and ' +
      '`message` states the count.',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async close(
    @CurrentUser() actor: CurrentUserType,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ): Promise<MyShopDto> {
    return this.shops.close(actor.id, shopId);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List shops',
    description:
      'No session required (invariant 1). Only live shops — APPROVED, not closed, not suspended, ' +
      'and whose owner is not banned (§92); a pending application never appears here. ' +
      'Optionally filtered by communityId (L8); omit it to see every community’s shops.',
  })
  @ApiPaginatedResponse(ShopDto)
  async list(@Query() query: ListShopsQueryDto): Promise<Page<ShopDto>> {
    return this.shops.list(query.communityId, query.limit, query.cursor);
  }

  @Get('pending')
  @ApiOperation({
    summary: 'List pending shop applications I may review',
    description:
      'Scoped to the caller automatically: every community for a super admin, or only the ' +
      'communities the caller administers (#32) — there is no communityId query param because ' +
      'it is not the caller’s to choose. A signed-in caller who administers nothing gets an ' +
      'empty page, not a 403; “what do I have to review” has a truthful answer of zero.',
  })
  @ApiPaginatedResponse(ShopAdminDto)
  @ApiCookieAuth('access_token')
  async pending(
    @CurrentUser() actor: CurrentUserType,
    @Query() query: ListPendingShopsQueryDto,
  ): Promise<Page<ShopAdminDto>> {
    return this.shopAdmin.pending(actor.id, actor.role, query.limit, query.cursor);
  }

  @Get('pending-profile-changes')
  @ApiOperation({
    summary: 'List waiting shop profile changes I may review',
    description:
      'Same scoping as GET /shops/pending: every community for a super admin, the caller’s own ' +
      'communities for a community admin, an empty page for anyone else (§86). Each item carries ' +
      'the live values beside the waiting ones; fetch a waiting logo at GET /shops/:id/pending-logo.',
  })
  @ApiPaginatedResponse(ShopProfileChangeDto)
  @ApiCookieAuth('access_token')
  async pendingProfileChanges(
    @CurrentUser() actor: CurrentUserType,
    @Query() query: ListPendingShopsQueryDto,
  ): Promise<Page<ShopProfileChangeDto>> {
    return this.shopAdmin.pendingProfileChanges(actor.id, actor.role, query.limit, query.cursor);
  }

  @Post(':shopId/approve')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ShopIdScopeResolver)
  @ApiOperation({
    summary: 'Approve a pending shop application',
    description:
      'Approved shops appear in the public list immediately. Same guard as every other ' +
      'community-admin action (#32): the caller must administer this shop’s community, or be ' +
      'a super admin. The shop’s own owner may not approve it, even if they also administer ' +
      'that community (N28). Recorded in audit_log.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ShopAdminDto })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this shop’s community admin, not a super admin, or the shop’s own owner.',
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
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<ShopAdminDto> {
    return this.shopAdmin.approve(actor.id, shopId, dto.reviewRevision);
  }

  @Post(':shopId/reject')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ShopIdScopeResolver)
  @ApiOperation({
    summary: 'Reject a pending shop application',
    description:
      'The reason is shown to the applicant on their own GET /shops/me, so they can fix it and ' +
      'apply again — rejecting also closes this row, which is what frees their one-shop slot ' +
      'for that new application. Same guard and self-approval rule as approving. Recorded in ' +
      'audit_log.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ShopAdminDto })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'The reason is missing or too short.',
  })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this shop’s community admin, not a super admin, or the shop’s own owner.',
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
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: RejectShopDto,
  ): Promise<ShopAdminDto> {
    return this.shopAdmin.reject(actor.id, shopId, dto.reason, dto.reviewRevision);
  }

  @Post(':shopId/profile-change/approve')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ShopIdScopeResolver)
  @ApiOperation({
    summary: 'Approve a shop’s waiting profile change',
    description:
      'Puts the waiting name/description and/or logo live, and deletes the logo it replaces (§86). ' +
      'Same guard and self-approval rule (N28) as approving a shop. Recorded in audit_log; the owner is notified.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: MyShopDto })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this shop’s community admin, not a super admin, or the shop’s own owner.',
  })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description:
      'CONFLICT — nothing waiting (already decided, never submitted, or the shop has closed — §109). STALE_VIEW — resubmitted since the reviewer opened it (§91).',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async approveProfileChange(
    @CurrentUser() actor: CurrentUserType,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<MyShopDto> {
    return this.shopAdmin.approveProfileChange(actor.id, shopId, dto.reviewRevision);
  }

  @Post(':shopId/profile-change/reject')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ShopIdScopeResolver)
  @ApiOperation({
    summary: 'Reject a shop’s waiting profile change',
    description:
      'Drops the waiting change (the storefront keeps what it had) and deletes a waiting logo. The ' +
      'reason is shown to the owner as profileChangeRejectionReason on GET /shops/me and in their ' +
      'notification (§86). Same guard and self-approval rule as approving. Recorded in audit_log.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: MyShopDto })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'The reason is missing or too short.',
  })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this shop’s community admin, not a super admin, or the shop’s own owner.',
  })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description:
      'CONFLICT — nothing waiting (already decided, never submitted, or the shop has closed — §109). STALE_VIEW — resubmitted since the reviewer opened it (§91).',
  })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async rejectProfileChange(
    @CurrentUser() actor: CurrentUserType,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: RejectShopDto,
  ): Promise<MyShopDto> {
    return this.shopAdmin.rejectProfileChange(actor.id, shopId, dto.reason, dto.reviewRevision);
  }

  @Post(':shopId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ShopIdScopeResolver)
  @ApiOperation({
    summary: 'Suspend an approved shop',
    description:
      'J2: no new sales, not a lock on finishing what is already in progress — nothing here ' +
      'blocks an order or product action, because that block lives at each of those actions, ' +
      'not as a blanket guard here (spec 4/12 forbids writing it as one). Same guard as every ' +
      'other community-admin action (#32); the shop’s own owner may not suspend it. Recorded ' +
      'in audit_log with the reason.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ShopAdminDto })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'The reason is missing or too short.',
  })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this shop’s community admin, not a super admin, or the shop’s own owner.',
  })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Already suspended, not approved yet, or closed (§109 — only a shop that is selling can be suspended).' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async suspend(
    @CurrentUser() actor: CurrentUserType,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: SuspendShopDto,
  ): Promise<ShopAdminDto> {
    return this.shopAdmin.suspend(actor.id, shopId, dto.reason);
  }

  @Post(':shopId/unsuspend')
  @HttpCode(HttpStatus.OK)
  @RequiresCommunityAdmin(ShopIdScopeResolver)
  @ApiOperation({
    summary: 'Lift a shop’s suspension',
    description: 'Same guard and self-suspension rule as suspending. Recorded in audit_log.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ShopAdminDto })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this shop’s community admin, not a super admin, or the shop’s own owner.',
  })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Not currently suspended.' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async unsuspend(
    @CurrentUser() actor: CurrentUserType,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ): Promise<ShopAdminDto> {
    return this.shopAdmin.unsuspend(actor.id, shopId);
  }

  @Get(':shopId')
  @Public()
  @ApiOperation({
    summary: 'View a shop',
    description:
      'No session required, and no community-membership check (invariant 1) — a buyer may ' +
      'browse a shop in any community. Only approvalStatus gates this: a shop nobody has ' +
      'approved yet answers 404 exactly like one that never existed, but a shop that was ' +
      'approved and later closed or suspended still answers 200 — check closedAt/suspendedAt ' +
      'on the response rather than relying on the status code (#37, #38). A banned owner reads ' +
      'as suspendedAt too (§92), on purpose — the public view never says an account was banned.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ShopDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async view(@Param('shopId', ParseUUIDPipe) shopId: string): Promise<ShopDto> {
    return this.shops.findPublic(shopId);
  }

  @Get(':shopId/logo')
  @Public()
  @ApiOperation({
    summary: 'Fetch a shop’s storefront photo',
    description:
      'Public — no session required, and no closedAt gate (#73), same reasoning as a product ' +
      'photo: an old direct link should keep resolving rather than 404 the moment a shop closes. ' +
      'A shop never approved answers 404 like GET /shops/:id does, except to its own owner (§86). ' +
      'Always the live logo — a logo waiting for review is never served here.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'The image bytes, Content-Type set to image/jpeg or image/png.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'No such shop, not approved (and not the owner asking), or no logo.',
  })
  async readLogo(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const { image, ownerOnly } = await this.shops.readLogo(
      shopId,
      readSession(request)?.user.id ?? null,
    );
    if (ownerOnly) {
      sendPrivateFile(response, image);
      return;
    }
    response.setHeader('Content-Type', image.contentType);
    response.send(image.buffer);
  }

  @Get(':shopId/banner')
  @Public()
  @ApiOperation({
    summary: 'Fetch a shop’s banner / cover photo',
    description: 'Public — no session required. Serves the shop banner photo.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'The image bytes, Content-Type set to image/jpeg or image/png.',
  })
  @ApiResponse({
    status: 404,
    type: ErrorResponseDto,
    description: 'No such shop, not approved (and not the owner asking), or no banner.',
  })
  async readBanner(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const { image, ownerOnly } = await this.shops.readBanner(
      shopId,
      readSession(request)?.user.id ?? null,
    );
    if (ownerOnly) {
      sendPrivateFile(response, image);
      return;
    }
    response.setHeader('Content-Type', image.contentType);
    response.send(image.buffer);
  }

  @Get(':shopId/pending-logo')
  @RequiresCommunityAdmin(ShopIdScopeResolver)
  @ApiOperation({
    summary: 'Fetch a shop’s logo that is waiting for review',
    description:
      'Same guard as approving the change (§86). Served private — nobody has approved it yet.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'The image bytes, Content-Type set to image/jpeg or image/png.',
  })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this shop’s community admin, not a super admin, or no such shop.',
  })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: 'No logo waiting.' })
  @ApiCookieAuth('access_token')
  async readPendingLogo(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Res() response: Response,
  ): Promise<void> {
    sendPrivateFile(response, await this.shops.readPendingLogoOf(shopId));
  }

  @Get(':shopId/admin')
  @RequiresCommunityAdmin(ShopIdScopeResolver)
  @ApiOperation({
    summary: 'View a shop as its community admin',
    description:
      'Reveals the owner and the moderation fields. Only an admin of *this* shop’s community ' +
      'may call this, or a super admin (#32) — a community admin of a different community, and ' +
      'a shop id that does not exist, answer with the identical 403 so neither can be told ' +
      'apart from the other.',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ShopAdminDto })
  @ApiResponse({
    status: 403,
    type: ErrorResponseDto,
    description: 'Not this shop’s community admin, not a super admin, or no such shop.',
  })
  @ApiCookieAuth('access_token')
  async viewAsAdmin(@Param('shopId', ParseUUIDPipe) shopId: string): Promise<ShopAdminDto> {
    return this.shopAdmin.findAdmin(shopId);
  }

  @Get(':shopId/follow-status')
  @Public()
  @ApiOperation({
    summary: 'Get follow status and follower count for a shop',
  })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiResponse({ status: 200 })
  async getFollowStatus(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Req() request: Request,
  ): Promise<{ followerCount: number; isFollowing: boolean }> {
    const userId = readSession(request)?.user.id ?? null;
    return this.shops.getFollowStatus(shopId, userId);
  }

  @Post(':shopId/follow')
  @HttpCode(HttpStatus.OK)
  @RequiresVerifiedEmail()
  @ApiOperation({ summary: 'Follow a shop' })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async followShop(
    @CurrentUser() actor: CurrentUserType,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ): Promise<{ success: boolean }> {
    await this.shops.followShop(actor.id, shopId);
    return { success: true };
  }

  @Delete(':shopId/follow')
  @HttpCode(HttpStatus.OK)
  @RequiresVerifiedEmail()
  @ApiOperation({ summary: 'Unfollow a shop' })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async unfollowShop(
    @CurrentUser() actor: CurrentUserType,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ): Promise<{ success: boolean }> {
    await this.shops.unfollowShop(actor.id, shopId);
    return { success: true };
  }
}
