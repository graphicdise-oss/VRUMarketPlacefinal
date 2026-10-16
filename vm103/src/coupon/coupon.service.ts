import { Injectable } from '@nestjs/common';
import { CouponDiscountType } from '@prisma/client';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock, addDays } from '../time/clock.js';
import { CouponDto } from './dto/coupon.dto.js';
import { CreateCouponDto } from './dto/create-coupon.dto.js';
import { UpdateCouponDto } from './dto/update-coupon.dto.js';
import { UserCouponClaimDto } from './dto/user-coupon-claim.dto.js';
import { ValidateCouponResponseDto } from './dto/validate-coupon.dto.js';
import { NotificationService } from '../notification/notification.service.js';

@Injectable()
export class CouponService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Helper: Find and verify that the user owns an active, approved shop.
   */
  private async requireOwnerShop(ownerId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { ownerId, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!shop) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบร้านค้าของคุณ หรือร้านค้าถูกปิดแล้ว' });
    }
    if (shop.approvalStatus !== 'APPROVED') {
      throw new AppException('CONFLICT', { message: 'ร้านค้าของคุณยังไม่ผ่านการอนุมัติ จึงยังไม่สามารถจัดการโค้ดส่วนลดได้' });
    }
    return shop;
  }

  /**
   * Seller: Create a new shop coupon / voucher
   */
  async createShopCoupon(ownerId: string, dto: CreateCouponDto): Promise<CouponDto> {
    const shop = await this.requireOwnerShop(ownerId);
    const now = this.clock.now();

    // eslint-disable-next-line no-restricted-syntax -- parsing date string from DTO
    const startDate = new Date(dto.startDate);
    // eslint-disable-next-line no-restricted-syntax -- parsing date string from DTO
    const endDate = new Date(dto.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new AppException('VALIDATION_FAILED', { message: 'รูปแบบวันที่ไม่ถูกต้อง' });
    }
    if (startDate >= endDate) {
      throw new AppException('VALIDATION_FAILED', { message: 'วันเริ่มต้นต้องอยู่ก่อนวันสิ้นสุด' });
    }

    if (dto.discountType === CouponDiscountType.PERCENTAGE) {
      if (dto.discountValue < 1 || dto.discountValue > 100) {
        throw new AppException('VALIDATION_FAILED', { message: 'ส่วนลดแบบเปอร์เซ็นต์ต้องอยู่ระหว่าง 1 ถึง 100%' });
      }
    } else if (dto.discountType === CouponDiscountType.FIXED_AMOUNT) {
      if (dto.discountValue < 100) {
        throw new AppException('VALIDATION_FAILED', { message: 'ส่วนลดแบบจำนวนเงินต้องไม่ต่ำกว่า 1 บาท (100 สตางค์)' });
      }
    }

    // Check unique code within the shop
    const normalizedCode = dto.code.trim().toUpperCase();
    const existing = await this.prisma.shopCoupon.findUnique({
      where: {
        shopId_code: {
          shopId: shop.id,
          code: normalizedCode,
        },
      },
    });

    if (existing) {
      throw new AppException('CONFLICT', { message: `โค้ดส่วนลด "${normalizedCode}" มีอยู่ในร้านนี้แล้ว กรุณาใช้ชื่ออื่น` });
    }

    const coupon = await this.prisma.shopCoupon.create({
      data: {
        id: newId(),
        shopId: shop.id,
        code: normalizedCode,
        name: dto.name.trim(),
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        minSpendAmountMinor: dto.minSpendAmountMinor ?? 0,
        maxDiscountAmountMinor: dto.maxDiscountAmountMinor ?? null,
        quota: dto.quota,
        claimedCount: 0,
        usedCount: 0,
        startDate,
        endDate,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      include: {
        shop: { select: { name: true } },
      },
    });

    return CouponDto.from(coupon);
  }

  /**
   * Seller: List all coupons created for their shop
   */
  async getShopCoupons(ownerId: string): Promise<CouponDto[]> {
    const shop = await this.requireOwnerShop(ownerId);
    const coupons = await this.prisma.shopCoupon.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: 'desc' },
      include: {
        shop: { select: { name: true } },
      },
    });

    return coupons.map((c) => CouponDto.from(c));
  }

  /**
   * Seller: Update a coupon
   */
  async updateShopCoupon(ownerId: string, couponId: string, dto: UpdateCouponDto): Promise<CouponDto> {
    const shop = await this.requireOwnerShop(ownerId);
    const coupon = await this.prisma.shopCoupon.findFirst({
      where: { id: couponId, shopId: shop.id },
    });

    if (!coupon) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบคูปองส่วนลดนี้' });
    }

    if (dto.quota !== undefined && dto.quota < coupon.claimedCount) {
      throw new AppException('VALIDATION_FAILED', {
        message: `จำนวนสิทธิ์ใหม่ (${dto.quota}) ต้องไม่น้อยกว่าจำนวนที่ถูกเก็บไปแล้ว (${coupon.claimedCount})`,
      });
    }

    let endDate: Date | undefined;
    if (dto.endDate) {
      // eslint-disable-next-line no-restricted-syntax -- parsing date string from DTO
      endDate = new Date(dto.endDate);
      if (isNaN(endDate.getTime())) {
        throw new AppException('VALIDATION_FAILED', { message: 'รูปแบบวันหมดอายุไม่ถูกต้อง' });
      }
      if (endDate <= coupon.startDate) {
        throw new AppException('VALIDATION_FAILED', { message: 'วันหมดอายุใหม่ต้องอยู่หลังวันเริ่มต้น' });
      }
    }

    const now = this.clock.now();
    const updated = await this.prisma.shopCoupon.update({
      where: { id: couponId },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        quota: dto.quota,
        endDate,
        isActive: dto.isActive,
        updatedAt: now,
      },
      include: {
        shop: { select: { name: true } },
      },
    });

    return CouponDto.from(updated);
  }

  /**
   * Seller: Delete or deactivate coupon
   */
  async deleteShopCoupon(ownerId: string, couponId: string): Promise<{ deleted: boolean; message: string }> {
    const shop = await this.requireOwnerShop(ownerId);
    const coupon = await this.prisma.shopCoupon.findFirst({
      where: { id: couponId, shopId: shop.id },
    });

    if (!coupon) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบคูปองส่วนลดนี้' });
    }

    if (coupon.usedCount > 0) {
      // If already used in orders, soft deactivate so order references stay valid
      await this.prisma.shopCoupon.update({
        where: { id: couponId },
        data: { isActive: false, updatedAt: this.clock.now() },
      });
      return { deleted: false, message: 'คูปองนี้ถูกใช้งานในคำสั่งซื้อแล้ว ระบบได้ปิดการใช้งานแทนการลบ' };
    }

    // If never used, delete claims and delete coupon
    await this.prisma.$transaction(async (tx) => {
      await tx.userCouponClaim.deleteMany({ where: { couponId } });
      await tx.shopCoupon.delete({ where: { id: couponId } });
    });

    return { deleted: true, message: 'ลบคูปองส่วนลดเรียบร้อยแล้ว' };
  }

  /**
   * Buyer / Public: List coupons of a shop (for storefront display)
   */
  async getPublicShopCoupons(shopId: string, buyerUserId?: string): Promise<CouponDto[]> {
    const now = this.clock.now();
    const coupons = await this.prisma.shopCoupon.findMany({
      where: {
        shopId,
        isActive: true,
        endDate: { gte: now },
      },
      orderBy: [{ minSpendAmountMinor: 'asc' }, { createdAt: 'desc' }],
      include: {
        shop: { select: { name: true } },
        claims: buyerUserId
          ? {
              where: { userId: buyerUserId },
              select: { id: true, isUsed: true },
            }
          : false,
      },
    });

    return coupons.map((c) => CouponDto.from(c, buyerUserId));
  }

  /**
   * Buyer / Public: List featured active coupons across shops for Home page
   */
  async getFeaturedCoupons(buyerUserId?: string, limit: number = 50): Promise<CouponDto[]> {
    const now = this.clock.now();
    const coupons = await this.prisma.shopCoupon.findMany({
      where: {
        isActive: true,
        endDate: { gte: now },
        shop: {
          approvalStatus: 'APPROVED',
          closedAt: null,
          suspendedAt: null,
        },
      },
      orderBy: [{ claimedCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        shop: { select: { id: true, name: true } },
        claims: buyerUserId
          ? {
              where: { userId: buyerUserId },
              select: { id: true, isUsed: true },
            }
          : false,
      },
    });

    return coupons.map((c) => CouponDto.from(c, buyerUserId));
  }

  /**
   * Buyer: Claim / collect a coupon
   */
  async claimCoupon(buyerUserId: string, couponId: string): Promise<UserCouponClaimDto> {
    const now = this.clock.now();

    // Disallow community admins from claiming coupons
    const communityAdmin = await this.prisma.communityAdmin.findFirst({
      where: { userId: buyerUserId },
    });
    if (communityAdmin) {
      throw new AppException('FORBIDDEN', { message: 'Community admins cannot collect coupons' });
    }

    const coupon = await this.prisma.shopCoupon.findUnique({
      where: { id: couponId },
      include: { shop: { select: { name: true, closedAt: true, suspendedAt: true } } },
    });

    if (!coupon || !coupon.isActive) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบคูปองส่วนลดนี้ หรือคูปองถูกปิดการใช้งาน' });
    }

    if (coupon.shop.closedAt !== null || coupon.shop.suspendedAt !== null) {
      throw new AppException('CONFLICT', { message: 'ร้านค้านี้ปิดให้บริการชั่วคราว จึงไม่สามารถเก็บคูปองได้' });
    }

    if (now > coupon.endDate) {
      throw new AppException('CONFLICT', { message: 'คูปองส่วนลดนี้หมดอายุแล้ว' });
    }

    if (now < coupon.startDate) {
      throw new AppException('CONFLICT', { message: 'คูปองนี้ยังไม่ถึงเวลาเริ่มเก็บสิทธิ์' });
    }

    // Check if buyer has already claimed
    const existing = await this.prisma.userCouponClaim.findUnique({
      where: {
        userId_couponId: {
          userId: buyerUserId,
          couponId,
        },
      },
    });

    if (existing) {
      throw new AppException('CONFLICT', { message: 'คุณได้เก็บคูปองส่วนลดนี้ไปแล้ว' });
    }

    // Atomically increment claimedCount and record claim
    const claim = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.shopCoupon.updateMany({
        where: {
          id: couponId,
          claimedCount: { lt: coupon.quota },
        },
        data: {
          claimedCount: { increment: 1 },
          updatedAt: now,
        },
      });

      if (updateResult.count === 0) {
        throw new AppException('CONFLICT', { message: 'ขออภัย คูปองนี้ถูกเก็บสิทธิ์จนครบแล้ว' });
      }

      return tx.userCouponClaim.create({
        data: {
          id: newId(),
          userId: buyerUserId,
          couponId,
          claimedAt: now,
          isUsed: false,
        },
        include: {
          coupon: {
            include: { shop: { select: { name: true } } },
          },
        },
      });
    });

    return UserCouponClaimDto.from(claim);
  }

  /**
   * Buyer: Get claimed coupons
   */
  async getMyClaimedCoupons(buyerUserId: string, shopId?: string): Promise<UserCouponClaimDto[]> {
    const now = this.clock.now();

    const claims = await this.prisma.userCouponClaim.findMany({
      where: {
        userId: buyerUserId,
        isUsed: false,
        coupon: {
          isActive: true,
          endDate: { gte: now },
          ...(shopId ? { shopId } : {}),
        },
      },
      orderBy: { claimedAt: 'desc' },
      include: {
        coupon: {
          include: { shop: { select: { name: true } } },
        },
      },
    });

    const threeDaysLater = addDays(now, 3);
    for (const c of claims) {
      if (c.coupon.endDate <= threeDaysLater) {
        void this.warnClaimExpiring(c.userId, c.couponId, c.coupon.code, c.coupon.name, c.coupon.endDate, now);
      }
    }

    return claims.map((c) => UserCouponClaimDto.from(c));
  }

  private async warnClaimExpiring(
    userId: string,
    couponId: string,
    code: string,
    name: string,
    endDate: Date,
    now: Date,
  ): Promise<void> {
    try {
      const existing = await this.prisma.notification.findFirst({
        where: {
          userId,
          type: 'COUPON_EXPIRING_WARNING',
          targetId: couponId,
        },
        select: { id: true },
      });

      if (!existing) {
        const msLeft = endDate.getTime() - now.getTime();
        const hoursLeft = Math.max(1, Math.floor(msLeft / (1000 * 60 * 60)));
        const daysLeft = Math.ceil(hoursLeft / 24);
        const timeText = daysLeft > 1 ? `ในอีก ${daysLeft} วัน` : `ในอีก ${hoursLeft} ชั่วโมง`;

        await this.notificationService.notify({
          userId,
          type: 'COUPON_EXPIRING_WARNING',
          message: `โค้ดส่วนลด "${code}" (${name}) ใกล้หมดอายุ${timeText} รีบใช้ช้อปก่อนหมดเขต!`,
          targetType: 'COUPON',
          targetId: couponId,
        });
      }
    } catch {
      // Swallowed: non-blocking warning check
    }
  }

  /**
   * Validate and calculate discount for checkout / cart preview
   */
  async validateAndCalculateDiscount(
    buyerUserId: string,
    shopId: string,
    couponCodeOrId: string,
    subtotalMinor: number,
  ): Promise<ValidateCouponResponseDto> {
    const now = this.clock.now();
    const query = couponCodeOrId.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);

    // Find coupon by id or code within shop
    const coupon = await this.prisma.shopCoupon.findFirst({
      where: {
        shopId,
        ...(isUuid ? { OR: [{ id: query }, { code: query.toUpperCase() }] } : { code: query.toUpperCase() }),
      },
      include: { shop: { select: { name: true } } },
    });

    if (!coupon || !coupon.isActive) {
      return {
        valid: false,
        discountAmountMinor: 0,
        reason: 'ไม่พบคูปองส่วนลดนี้ หรือถูกปิดการใช้งาน',
      };
    }

    if (now > coupon.endDate) {
      return {
        valid: false,
        discountAmountMinor: 0,
        reason: 'คูปองส่วนลดหมดอายุแล้ว',
      };
    }

    if (now < coupon.startDate) {
      return {
        valid: false,
        discountAmountMinor: 0,
        reason: 'คูปองยังไม่เริ่มใช้งาน',
      };
    }

    // Check if user has claimed it and not used it yet
    const claim = await this.prisma.userCouponClaim.findUnique({
      where: {
        userId_couponId: {
          userId: buyerUserId,
          couponId: coupon.id,
        },
      },
    });

    let activeClaim = claim;
    if (!activeClaim) {
      if (coupon.claimedCount >= coupon.quota) {
        return {
          valid: false,
          discountAmountMinor: 0,
          reason: 'สิทธิ์ของคูปองส่วนลดนี้ถูกใช้หมดแล้ว',
        };
      }
      // Auto-claim for buyer
      await this.prisma.shopCoupon.update({
        where: { id: coupon.id },
        data: { claimedCount: { increment: 1 } },
      });
      activeClaim = await this.prisma.userCouponClaim.create({
        data: {
          id: newId(),
          userId: buyerUserId,
          couponId: coupon.id,
          claimedAt: now,
        },
      });
    }

    if (activeClaim.isUsed) {
      return {
        valid: false,
        discountAmountMinor: 0,
        reason: 'คุณใช้คูปองส่วนลดนี้ไปแล้ว',
      };
    }

    // Check min spend
    if (subtotalMinor < coupon.minSpendAmountMinor) {
      const minBaht = (coupon.minSpendAmountMinor / 100).toLocaleString();
      return {
        valid: false,
        discountAmountMinor: 0,
        reason: `ยอดสั่งซื้อขั้นต่ำต้องถึง ${minBaht} บาท`,
      };
    }

    // Calculate discount
    let discountSatang = 0;
    if (coupon.discountType === CouponDiscountType.FIXED_AMOUNT) {
      discountSatang = Math.min(subtotalMinor, coupon.discountValue);
    } else if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
      discountSatang = Math.round(subtotalMinor * (coupon.discountValue / 100));
      if (coupon.maxDiscountAmountMinor && coupon.maxDiscountAmountMinor > 0) {
        discountSatang = Math.min(discountSatang, coupon.maxDiscountAmountMinor);
      }
      discountSatang = Math.min(subtotalMinor, discountSatang);
    }

    return {
      valid: true,
      coupon: CouponDto.from(coupon),
      discountAmountMinor: discountSatang,
    };
  }
}
