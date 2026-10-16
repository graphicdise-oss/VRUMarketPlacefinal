import { ApiProperty } from '@nestjs/swagger';
import { CouponDiscountType, type ShopCoupon } from '@prisma/client';

export class CouponDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ nullable: true })
  shopName!: string | null;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: CouponDiscountType })
  discountType!: CouponDiscountType;

  @ApiProperty({ description: 'Satang for FIXED_AMOUNT or % for PERCENTAGE' })
  discountValue!: number;

  @ApiProperty({ description: 'Satang (integer)' })
  minSpendAmountMinor!: number;

  @ApiProperty({ nullable: true, description: 'Satang (integer)' })
  maxDiscountAmountMinor!: number | null;

  @ApiProperty()
  quota!: number;

  @ApiProperty()
  claimedCount!: number;

  @ApiProperty()
  usedCount!: number;

  @ApiProperty()
  remainingQuota!: number;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ nullable: true })
  isClaimed?: boolean;

  @ApiProperty({ nullable: true })
  isUsed?: boolean;

  static from(
    row: ShopCoupon & {
      shop?: { name: string } | null;
      claims?: { id: string; isUsed: boolean }[];
    },
    buyerUserId?: string,
  ): CouponDto {
    const dto = new CouponDto();
    dto.id = row.id;
    dto.shopId = row.shopId;
    dto.shopName = row.shop?.name ?? null;
    dto.code = row.code;
    dto.name = row.name;
    dto.discountType = row.discountType;
    dto.discountValue = row.discountValue;
    dto.minSpendAmountMinor = row.minSpendAmountMinor;
    dto.maxDiscountAmountMinor = row.maxDiscountAmountMinor;
    dto.quota = row.quota;
    dto.claimedCount = row.claimedCount;
    dto.usedCount = row.usedCount;
    dto.remainingQuota = Math.max(0, row.quota - row.claimedCount);
    dto.startDate = row.startDate.toISOString();
    dto.endDate = row.endDate.toISOString();
    dto.isActive = row.isActive;

    const firstClaim = row.claims?.[0];
    if (buyerUserId && firstClaim) {
      dto.isClaimed = true;
      dto.isUsed = firstClaim.isUsed;
    } else if (buyerUserId) {
      dto.isClaimed = false;
      dto.isUsed = false;
    }

    return dto;
  }
}
