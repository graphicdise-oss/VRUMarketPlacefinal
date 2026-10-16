import { ApiProperty } from '@nestjs/swagger';
import { type ShopCoupon, type UserCouponClaim } from '@prisma/client';
import { CouponDto } from './coupon.dto.js';

export class UserCouponClaimDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  couponId!: string;

  @ApiProperty({ type: CouponDto })
  coupon!: CouponDto;

  @ApiProperty()
  claimedAt!: string;

  @ApiProperty()
  isUsed!: boolean;

  @ApiProperty({ nullable: true })
  usedAt!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  orderId!: string | null;

  static from(
    row: UserCouponClaim & {
      coupon: ShopCoupon & {
        shop?: { name: string } | null;
      };
    },
  ): UserCouponClaimDto {
    const dto = new UserCouponClaimDto();
    dto.id = row.id;
    dto.couponId = row.couponId;
    dto.coupon = CouponDto.from(row.coupon);
    dto.claimedAt = row.claimedAt.toISOString();
    dto.isUsed = row.isUsed;
    dto.usedAt = row.usedAt ? row.usedAt.toISOString() : null;
    dto.orderId = row.orderId;
    return dto;
  }
}
