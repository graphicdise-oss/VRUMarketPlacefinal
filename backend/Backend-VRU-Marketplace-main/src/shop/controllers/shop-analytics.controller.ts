import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { type CurrentUser as CurrentUserType } from '../../auth/authenticated-request.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ShopAnalyticsService } from '../services/shop-analytics.service.js';

export class ShopStatsDto {
  // งานของร้าน (Action Required)
  awaitingShippingFeeCount!: number; // ใส่ค่าส่ง (AWAITING_SHIPPING_QUOTE)
  awaitingPaymentConfirmCount!: number; // ยืนยันเงินเข้า (PAYMENT_SUBMITTED)
  awaitingShipmentCount!: number; // ส่งของ (PAID)
  pendingRefundCount!: number; // คืนเงิน (REFUND_ORDERED)
  actionableDisputeCount!: number; // ตอบข้อพิพาท (Dispute open, no shop response or just open disputes)

  // รอคนอื่น (Pending Others)
  awaitingBuyerPaymentCount!: number; // รอผู้ซื้อโอน (AWAITING_PAYMENT)
  awaitingBuyerReceiveCount!: number; // รอกดรับของ (SHIPPED)
  frozenOrderCount!: number; // ถูกแช่แข็ง (frozenAt != null)
  
  // สินค้า (Products)
  activeProductCount!: number; // ขายอยู่ (APPROVED, PUBLISHED)
  pendingProductCount!: number; // รอตรวจ (PENDING)
  rejectedProductCount!: number; // ถูกปฏิเสธ (REJECTED)
  hiddenProductCount!: number; // ซ่อนไว้ (UNPUBLISHED)

  // ยอดขายและรีวิว (Sales & Reviews)
  totalSales!: number; // ยอดขาย (PAID, SHIPPED, COMPLETED)
  reviewAverage!: number; // คะแนนรีวิว
  reviewCount!: number; // จำนวนรีวิว
  followerCount!: number; // จำนวนผู้ติดตาม
}

@ApiTags('Shop Analytics')
@ApiBearerAuth()
@Controller('shops/me/dashboard')
export class ShopAnalyticsController {
  constructor(private readonly analytics: ShopAnalyticsService) {}

  @Get()
  @ApiOperation({ summary: 'Get shop dashboard stats for the authenticated owner' })
  @ApiResponse({ status: 200, type: ShopStatsDto })
  async getSummary(@CurrentUser() user: CurrentUserType): Promise<ShopStatsDto> {
    const userId = user.id;
    return this.analytics.getShopStats(userId);
  }
}

