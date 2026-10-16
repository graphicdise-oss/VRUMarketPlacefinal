import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { readSession, type CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequiresVerifiedEmail } from '../auth/decorators/requires-verified-email.decorator.js';
import { CouponService } from './coupon.service.js';
import { CouponDto } from './dto/coupon.dto.js';
import { CreateCouponDto } from './dto/create-coupon.dto.js';
import { UpdateCouponDto } from './dto/update-coupon.dto.js';
import { UserCouponClaimDto } from './dto/user-coupon-claim.dto.js';
import { ValidateCouponRequestDto, ValidateCouponResponseDto } from './dto/validate-coupon.dto.js';

@ApiTags('coupons')
@Controller()
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  // ==========================================
  // SELLER ENDPOINTS (Shop Center)
  // ==========================================

  @Post('shops/me/coupons')
  @ApiOperation({ summary: 'Seller: Create a new coupon for your shop' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  @RequiresVerifiedEmail()
  async createCoupon(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreateCouponDto,
  ): Promise<CouponDto> {
    return this.couponService.createShopCoupon(actor.id, dto);
  }

  @Get('shops/me/coupons')
  @ApiOperation({ summary: 'Seller: List all coupons created for your shop' })
  @ApiCookieAuth('access_token')
  @RequiresVerifiedEmail()
  async getShopCoupons(@CurrentUser() actor: CurrentUserType): Promise<CouponDto[]> {
    return this.couponService.getShopCoupons(actor.id);
  }

  @Patch('shops/me/coupons/:couponId')
  @ApiOperation({ summary: 'Seller: Update a coupon' })
  @ApiParam({ name: 'couponId', format: 'uuid' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  @RequiresVerifiedEmail()
  async updateCoupon(
    @CurrentUser() actor: CurrentUserType,
    @Param('couponId', ParseUUIDPipe) couponId: string,
    @Body() dto: UpdateCouponDto,
  ): Promise<CouponDto> {
    return this.couponService.updateShopCoupon(actor.id, couponId, dto);
  }

  @Delete('shops/me/coupons/:couponId')
  @ApiOperation({ summary: 'Seller: Delete or deactivate a coupon' })
  @ApiParam({ name: 'couponId', format: 'uuid' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  @RequiresVerifiedEmail()
  async deleteCoupon(
    @CurrentUser() actor: CurrentUserType,
    @Param('couponId', ParseUUIDPipe) couponId: string,
  ): Promise<{ deleted: boolean; message: string }> {
    return this.couponService.deleteShopCoupon(actor.id, couponId);
  }

  // ==========================================
  // PUBLIC / BUYER ENDPOINTS
  // ==========================================

  @Get('shops/:shopId/coupons')
  @Public()
  @ApiOperation({ summary: 'Public: List active coupons for a shop storefront' })
  @ApiParam({ name: 'shopId', format: 'uuid' })
  async getPublicShopCoupons(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Req() req: Request,
  ): Promise<CouponDto[]> {
    const session = readSession(req);
    const buyerUserId = session ? session.user.id : undefined;
    return this.couponService.getPublicShopCoupons(shopId, buyerUserId);
  }

  @Get('coupons/featured')
  @Public()
  @ApiOperation({ summary: 'Public: List active featured coupons across shops' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of coupons to fetch (default: 50)' })
  async getFeaturedCoupons(
    @Req() req: Request,
    @Query('limit') limitStr?: string,
  ): Promise<CouponDto[]> {
    const session = readSession(req);
    const buyerUserId = session ? session.user.id : undefined;
    const limit = limitStr ? Math.min(100, Math.max(1, parseInt(limitStr, 10) || 50)) : 50;
    return this.couponService.getFeaturedCoupons(buyerUserId, limit);
  }

  @Post('coupons/:couponId/claim')
  @ApiOperation({ summary: 'Buyer: Claim / collect a coupon voucher' })
  @ApiParam({ name: 'couponId', format: 'uuid' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  @RequiresVerifiedEmail()
  async claimCoupon(
    @CurrentUser() actor: CurrentUserType,
    @Param('couponId', ParseUUIDPipe) couponId: string,
  ): Promise<UserCouponClaimDto> {
    return this.couponService.claimCoupon(actor.id, couponId);
  }

  @Get('coupons/my-claims')
  @ApiOperation({ summary: 'Buyer: List my claimed unexpired vouchers' })
  @ApiQuery({ name: 'shopId', format: 'uuid', required: false })
  @ApiCookieAuth('access_token')
  async getMyClaimedCoupons(
    @CurrentUser() actor: CurrentUserType,
    @Query('shopId') shopId?: string,
  ): Promise<UserCouponClaimDto[]> {
    return this.couponService.getMyClaimedCoupons(actor.id, shopId);
  }

  @Post('coupons/validate')
  @ApiOperation({ summary: 'Buyer: Validate coupon and calculate instant discount' })
  @ApiCookieAuth('access_token')
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async validateCoupon(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: ValidateCouponRequestDto,
  ): Promise<ValidateCouponResponseDto> {
    return this.couponService.validateAndCalculateDiscount(
      actor.id,
      dto.shopId,
      dto.couponCodeOrId,
      dto.subtotalMinor,
    );
  }
}
