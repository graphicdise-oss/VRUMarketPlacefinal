import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  OrderStatus,
  OrderCancelledBy,
  ProductModerationStatus,
  ShopPublishStatus,
  CouponDiscountType,
} from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const newId = () => uuidv7();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  console.log('🚀 Seeding comprehensive dashboard data for ALL seller accounts...');

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  // 1. Fetch buyers & auxiliary users for follows / reviews
  const buyer = await prisma.user.findFirst({ where: { email: 'buyer.demo@vru.ac.th' } });
  const communityAdmin = await prisma.user.findFirst({ where: { email: 'community.admin@vru.ac.th' } });
  if (!buyer) throw new Error('buyer.demo@vru.ac.th not found!');

  // 2. Fetch carriers
  const carriers = await prisma.shippingCarrier.findMany();
  const kerry = carriers.find(c => c.name.toLowerCase().includes('kerry')) ?? carriers[0];
  const flash = carriers.find(c => c.name.toLowerCase().includes('flash')) ?? carriers[0];

  // 3. Fetch all shops with their owners and products
  const shops = await prisma.shop.findMany({
    include: {
      owner: true,
      products: {
        include: { variants: true },
      },
    },
  });

  console.log(`Found ${shops.length} shops in system.`);

  const defaultAddress = {
    recipientName: 'สมใจ รักเรียน',
    phone: '0891234567',
    houseNumber: '99 หมู่ 5 ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี 12120',
    subdistrictName: 'คลองหนึ่ง',
    districtName: 'คลองหลวง',
    provinceName: 'ปทุมธานี',
    postalCode: '12120',
    currency: 'THB',
  };

  // Prefixes map for nice coupon codes per shop
  const prefixMap: Record<string, string> = {
    'seller.demo@vru.ac.th': 'DEMO',
    'seller1@vru.ac.th': 'ORANGE',
    'seller2@vru.ac.th': 'CRAFT',
    'seller3@vru.ac.th': 'HERB',
    'seller4@vru.ac.th': 'FABRIC',
    'seller5@vru.ac.th': 'BAKE',
    'seller6@vru.ac.th': 'HYDRO',
  };

  for (const shop of shops) {
    const ownerEmail = shop.owner?.email ?? '';
    const prefix = prefixMap[ownerEmail] || `SHOP${shop.id.slice(0, 4).toUpperCase()}`;

    console.log(`\n======================================================`);
    console.log(`🏪 Processing Shop: "${shop.name}" (${ownerEmail}) [Prefix: ${prefix}]`);
    console.log(`======================================================`);

    // ------------------------------------------------------------------
    // A. PRODUCTS (Ensure Approved, Pending, and Rejected products exist)
    // ------------------------------------------------------------------
    let approvedProds = shop.products.filter(p => p.moderationStatus === ProductModerationStatus.APPROVED && !p.deletedAt);
    let pendingProd = shop.products.find(p => p.moderationStatus === ProductModerationStatus.PENDING && !p.deletedAt);
    let rejectedProd = shop.products.find(p => p.moderationStatus === ProductModerationStatus.REJECTED && !p.deletedAt);

    const firstCat = approvedProds[0]?.categoryId ?? (await prisma.category.findFirst())?.id;
    if (!firstCat) throw new Error('No category found!');

    if (!pendingProd) {
      const pId = newId();
      pendingProd = await prisma.product.create({
        data: {
          id: pId,
          shopId: shop.id,
          categoryId: firstCat,
          name: `[รอตรวจสอบ] สินค้าใหม่ประจำฤดูกาล ชุมชน มรว.`,
          description: 'สินค้าตัวอย่างที่เพิ่งส่งขออนุมัติจากผู้ดูแลชุมชนเพื่อตรวจสอบคุณภาพมาตรฐาน',
          moderationStatus: ProductModerationStatus.PENDING,
          shopPublishStatus: ShopPublishStatus.PUBLISHED,
          createdAt: now,
          updatedAt: now,
          variants: {
            create: {
              id: newId(),
              name: 'ขนาดทดลอง 100 กรัม',
              priceAmountMinor: 12000,
              stock: 50,
              currency: 'THB',
              createdAt: now,
              updatedAt: now,
            },
          },
        },
        include: { variants: true },
      });
      console.log(`📦 Created Pending Product for shop: ${pendingProd.name}`);
    }

    if (!rejectedProd) {
      const pId = newId();
      rejectedProd = await prisma.product.create({
        data: {
          id: pId,
          shopId: shop.id,
          categoryId: firstCat,
          name: `[ถูกปฏิเสธ] สินค้าต้นแบบบรรจุภัณฑ์เดิม (ต้องแนบเอกสารรับรอง)`,
          description: 'สินค้าที่เอกสารรับรองมาตรฐานไม่ครบถ้วน ถูกปฏิเสธเพื่อให้ร้านค้าแก้ไขเอกสาร',
          moderationStatus: ProductModerationStatus.REJECTED,
          shopPublishStatus: ShopPublishStatus.UNPUBLISHED,
          createdAt: now,
          updatedAt: now,
          variants: {
            create: {
              id: newId(),
              name: 'รุ่นทดสอบ',
              priceAmountMinor: 15000,
              stock: 20,
              currency: 'THB',
              createdAt: now,
              updatedAt: now,
            },
          },
        },
        include: { variants: true },
      });
      console.log(`📦 Created Rejected Product for shop: ${rejectedProd.name}`);
    }

    // Refresh products
    const freshProducts = await prisma.product.findMany({
      where: { shopId: shop.id, moderationStatus: ProductModerationStatus.APPROVED, deletedAt: null },
      include: { variants: true },
    });
    const activeVariants = freshProducts.flatMap(p => p.variants.map(v => ({ prod: p, variant: v })));
    const sampleItem = activeVariants[0] ?? {
      prod: freshProducts[0] ?? pendingProd,
      variant: freshProducts[0]?.variants[0] ?? pendingProd.variants[0]!,
    };

    // ------------------------------------------------------------------
    // B. SHOP FOLLOWERS (Ensure 2-3 followers)
    // ------------------------------------------------------------------
    await prisma.shopFollow.upsert({
      where: { userId_shopId: { userId: buyer.id, shopId: shop.id } },
      update: {},
      create: { id: newId(), userId: buyer.id, shopId: shop.id },
    });
    if (communityAdmin) {
      await prisma.shopFollow.upsert({
        where: { userId_shopId: { userId: communityAdmin.id, shopId: shop.id } },
        update: {},
        create: { id: newId(), userId: communityAdmin.id, shopId: shop.id },
      });
    }
    console.log(`👥 Updated followers for shop`);

    // ------------------------------------------------------------------
    // C. ORDERS (Clean existing mock orders and build full workflow set)
    // ------------------------------------------------------------------
    // Every seeded order carries one line: unit price x QTY. Totals below are derived from it so
    // the order screen never shows a total that disagrees with its own line items.
    const QTY = 2;
    const unitPrice = sampleItem.variant.priceAmountMinor || 20000;
    const lineTotal = unitPrice * QTY;

    // One transaction per shop: either the shop gets its complete, consistent set of orders or it
    // keeps what it had. (A half-finished run used to leave orders with no items.)
    await prisma.$transaction(async (tx) => {
    // Delete every RESTRICT-linked dependent first so this script can be re-run after other seeds.
    const ofShop = { order: { shopId: shop.id } };
    await tx.disputeEvidence.deleteMany({ where: { dispute: { shopId: shop.id } } });
    await tx.dispute.deleteMany({ where: { shopId: shop.id } });
    await tx.review.deleteMany({ where: { shopId: shop.id } });
    await tx.orderFreezeReason.deleteMany({ where: ofShop });
    await tx.trackingNumberChange.deleteMany({ where: ofShop });
    await tx.shippingFeeRejection.deleteMany({ where: ofShop });
    await tx.refundSlip.deleteMany({ where: ofShop });
    await tx.shippingSlip.deleteMany({ where: ofShop });
    await tx.paymentSlip.deleteMany({ where: ofShop });
    await tx.stockReservation.deleteMany({ where: { orderItem: ofShop } });
    await tx.orderItem.deleteMany({ where: ofShop });
    await tx.order.deleteMany({ where: { shopId: shop.id } });

    interface Spec {
      status: OrderStatus;
      shippingAmountMinor: number | null;
      totalAmountMinor: number | null;
      shippingQuoteWindowStartedAt?: Date;
      paymentWindowStartedAt?: Date;
      paymentConfirmationWindowStartedAt?: Date;
      sellerConfirmedAt?: Date;
      sellerConfirmedBy?: string;
      shippedAt?: Date;
      completedAt?: Date;
      cancelledAt?: Date;
      cancelledBy?: OrderCancelledBy;
      cancelReason?: string;
      frozenAt?: Date;
      shippingCarrierId?: string;
      shippingCarrierNameAtShipment?: string;
      trackingNumber?: string;
      hoursAgo: number;
      isReviewableCompleted?: boolean;
    }

    const orderSpecs: Spec[] = [
      // 1. Action Required: ใส่ค่าจัดส่ง
      {
        status: OrderStatus.AWAITING_SHIPPING_QUOTE,
        shippingAmountMinor: null,
        totalAmountMinor: null,
        shippingQuoteWindowStartedAt: new Date(now.getTime() - 2 * 3600 * 1000),
        hoursAgo: 2,
      },
      // 2. Action Required: ยืนยันเงินเข้า (PAYMENT_SUBMITTED)
      {
        status: OrderStatus.PAYMENT_SUBMITTED,
        shippingAmountMinor: 4500,
        totalAmountMinor: lineTotal + 4500,
        shippingQuoteWindowStartedAt: new Date(now.getTime() - 20 * 3600 * 1000),
        paymentWindowStartedAt: new Date(now.getTime() - 10 * 3600 * 1000),
        paymentConfirmationWindowStartedAt: new Date(now.getTime() - 1 * 3600 * 1000),
        hoursAgo: 20,
      },
      // 3. Action Required: รอจัดส่ง (PAID)
      {
        status: OrderStatus.PAID,
        shippingAmountMinor: 4000,
        totalAmountMinor: lineTotal + 4000,
        sellerConfirmedAt: new Date(now.getTime() - 4 * 3600 * 1000),
        sellerConfirmedBy: shop.ownerId,
        hoursAgo: 24,
      },
      // 4. Action Required: ข้อพิพาท / ขอคืนเงิน (REFUND_ORDERED)
      {
        status: OrderStatus.REFUND_ORDERED,
        shippingAmountMinor: 4000,
        totalAmountMinor: lineTotal + 4000,
        sellerConfirmedAt: new Date(now.getTime() - 3 * dayMs),
        sellerConfirmedBy: shop.ownerId,
        shippedAt: new Date(now.getTime() - 2 * dayMs),
        shippingCarrierId: flash?.id,
        shippingCarrierNameAtShipment: flash?.name || 'Flash',
        trackingNumber: 'FLASH-VRU-REFUND01',
        hoursAgo: 72,
      },
      // 4b. History: คืนเงินเรียบร้อยแล้ว (REFUNDED)
      {
        status: OrderStatus.REFUNDED,
        shippingAmountMinor: 4000,
        totalAmountMinor: lineTotal + 4000,
        sellerConfirmedAt: new Date(now.getTime() - 9 * dayMs),
        sellerConfirmedBy: shop.ownerId,
        shippedAt: new Date(now.getTime() - 8 * dayMs),
        shippingCarrierId: flash?.id,
        shippingCarrierNameAtShipment: flash?.name || 'Flash',
        trackingNumber: 'FLASH-VRU-REFUNDED01',
        cancelledAt: new Date(now.getTime() - 6 * dayMs),
        cancelledBy: OrderCancelledBy.SHOP,
        cancelReason: 'สินค้าเสียหายระหว่างขนส่ง ร้านค้าคืนเงินเต็มจำนวน',
        hoursAgo: 216,
      },
      // 5. Pending: รอผู้ซื้อโอนเงิน (AWAITING_PAYMENT)
      {
        status: OrderStatus.AWAITING_PAYMENT,
        shippingAmountMinor: 5000,
        totalAmountMinor: lineTotal + 5000,
        shippingQuoteWindowStartedAt: new Date(now.getTime() - 8 * 3600 * 1000),
        paymentWindowStartedAt: new Date(now.getTime() - 2 * 3600 * 1000),
        hoursAgo: 8,
      },
      // 6. Pending: รอกดรับของ (SHIPPED)
      {
        status: OrderStatus.SHIPPED,
        shippingAmountMinor: 6000,
        totalAmountMinor: lineTotal + 6000,
        sellerConfirmedAt: new Date(now.getTime() - 2 * dayMs),
        sellerConfirmedBy: shop.ownerId,
        shippedAt: new Date(now.getTime() - 1 * dayMs),
        shippingCarrierId: kerry?.id,
        shippingCarrierNameAtShipment: kerry?.name || 'Kerry Express',
        trackingNumber: 'KERRY-VRU-TRACK99',
        hoursAgo: 48,
      },
      // 7. Pending: ถูกแช่แข็ง (FROZEN)
      {
        status: OrderStatus.AWAITING_SHIPPING_QUOTE,
        shippingAmountMinor: null,
        totalAmountMinor: null,
        frozenAt: new Date(now.getTime() - 3 * 3600 * 1000),
        hoursAgo: 15,
      },
      // 8. Sales: ออเดอร์สำเร็จ พร้อมรีวิว (COMPLETED)
      {
        status: OrderStatus.COMPLETED,
        shippingAmountMinor: 4000,
        totalAmountMinor: lineTotal + 4000,
        sellerConfirmedAt: new Date(now.getTime() - 6 * dayMs),
        sellerConfirmedBy: shop.ownerId,
        shippedAt: new Date(now.getTime() - 4 * dayMs),
        completedAt: new Date(now.getTime() - 1 * dayMs),
        shippingCarrierId: kerry?.id,
        shippingCarrierNameAtShipment: kerry?.name || 'Kerry Express',
        trackingNumber: 'KERRY-VRU-COMPLETED01',
        hoursAgo: 144,
        isReviewableCompleted: true,
      },
      // 8b. Sales: ออเดอร์สำเร็จ รอผู้ซื้อเขียนรีวิว (COMPLETED - unreviewed for testing review flow)
      {
        status: OrderStatus.COMPLETED,
        shippingAmountMinor: 4000,
        totalAmountMinor: lineTotal + 4000,
        sellerConfirmedAt: new Date(now.getTime() - 5 * dayMs),
        sellerConfirmedBy: shop.ownerId,
        shippedAt: new Date(now.getTime() - 3 * dayMs),
        completedAt: new Date(now.getTime() - 12 * 3600 * 1000),
        shippingCarrierId: kerry?.id,
        shippingCarrierNameAtShipment: kerry?.name || 'Kerry Express',
        trackingNumber: 'KERRY-VRU-AWAIT-REVIEW',
        hoursAgo: 120,
        isReviewableCompleted: false,
      },
      // 9. Cancelled
      {
        status: OrderStatus.CANCELLED,
        shippingAmountMinor: null,
        totalAmountMinor: null,
        cancelledAt: new Date(now.getTime() - 4 * dayMs),
        cancelledBy: OrderCancelledBy.BUYER,
        cancelReason: 'ลูกค้าขอยกเลิกคำสั่งซื้อ',
        hoursAgo: 96,
      },
    ];

    let createdCompletedOrderId: string | null = null;

    for (const s of orderSpecs) {
      const oId = newId();
      const createdAt = new Date(now.getTime() - s.hoursAgo * 3600 * 1000);
      await tx.order.create({
        data: {
          id: oId,
          buyerId: buyer.id,
          shopId: shop.id,
          status: s.status,
          shippingAmountMinor: s.shippingAmountMinor,
          totalAmountMinor: s.totalAmountMinor,
          shippingQuoteWindowStartedAt: s.shippingQuoteWindowStartedAt,
          paymentWindowStartedAt: s.paymentWindowStartedAt,
          paymentConfirmationWindowStartedAt: s.paymentConfirmationWindowStartedAt,
          sellerConfirmedAt: s.sellerConfirmedAt,
          sellerConfirmedBy: s.sellerConfirmedBy,
          shippedAt: s.shippedAt,
          completedAt: s.completedAt,
          cancelledAt: s.cancelledAt,
          cancelledBy: s.cancelledBy,
          cancelReason: s.cancelReason,
          frozenAt: s.frozenAt,
          shippingCarrierId: s.shippingCarrierId,
          shippingCarrierNameAtShipment: s.shippingCarrierNameAtShipment,
          trackingNumber: s.trackingNumber,
          createdAt,
          updatedAt: createdAt,
          ...defaultAddress,
        },
      });

      await tx.orderItem.create({
        data: {
          id: newId(),
          orderId: oId,
          variantId: sampleItem.variant.id,
          productNameAtPurchase: sampleItem.prod.name,
          variantNameAtPurchase: sampleItem.variant.name,
          priceAtPurchase: unitPrice,
          quantity: QTY,
          currency: 'THB',
          createdAt,
        },
      });

      if (s.isReviewableCompleted) {
        createdCompletedOrderId = oId;
      }
    }

    console.log(`🛒 Created ${orderSpecs.length} comprehensive orders covering all status tabs!`);

    // ------------------------------------------------------------------
    // D. REVIEWS (Add 2 reviews for rating display)
    // ------------------------------------------------------------------
    if (createdCompletedOrderId) {
      await tx.review.create({
        data: {
          id: newId(),
          orderId: createdCompletedOrderId,
          buyerId: buyer.id,
          shopId: shop.id,
          rating: 5,
          text: 'สินค้าคุณภาพดีมาก การแพ็คเกจเรียบร้อย สดสะอาด แนะนำร้านนี้เลยครับ!',
          createdAt: new Date(now.getTime() - 1 * dayMs),
          updatedAt: new Date(now.getTime() - 1 * dayMs),
        },
      });
      console.log(`⭐ Created 5-star review for shop!`);
    }
    }, { timeout: 60_000, maxWait: 10_000 });

    // ------------------------------------------------------------------
    // E. COUPONS (Active, Expiring in 2 days, and Expired)
    // ------------------------------------------------------------------
    // 1. Active normal coupon (30 days left)
    const codeNormal = `${prefix}10`;
    await prisma.shopCoupon.upsert({
      where: { shopId_code: { shopId: shop.id, code: codeNormal } },
      update: {
        isActive: true,
        endDate: new Date(now.getTime() + 30 * dayMs),
      },
      create: {
        id: newId(),
        shopId: shop.id,
        code: codeNormal,
        name: `ส่วนลดพิเศษต้อนรับลูกค้าใหม่ 10%`,
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 10,
        minSpendAmountMinor: 20000, // ขั้นต่ำ ฿200
        maxDiscountAmountMinor: 10000, // สูงสุด ฿100
        quota: 100,
        claimedCount: 25,
        usedCount: 10,
        startDate: new Date(now.getTime() - 5 * dayMs),
        endDate: new Date(now.getTime() + 30 * dayMs),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    // 2. Expiring coupon (2 days left -> triggers warning badge!)
    const codeExpiring = `${prefix}FLASH`;
    const expiringCoupon = await prisma.shopCoupon.upsert({
      where: { shopId_code: { shopId: shop.id, code: codeExpiring } },
      update: {
        isActive: true,
        endDate: new Date(now.getTime() + 2 * dayMs),
      },
      create: {
        id: newId(),
        shopId: shop.id,
        code: codeExpiring,
        name: `โค้ดลดด่วน ฿50 ประจำสัปดาห์ (ใกล้หมดอายุ)`,
        discountType: CouponDiscountType.FIXED_AMOUNT,
        discountValue: 5000, // ฿50
        minSpendAmountMinor: 25000, // ขั้นต่ำ ฿250
        maxDiscountAmountMinor: null,
        quota: 50,
        claimedCount: 15,
        usedCount: 8,
        startDate: new Date(now.getTime() - 5 * dayMs),
        endDate: new Date(now.getTime() + 2 * dayMs),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Pre-claim this expiring coupon for buyer.demo so buyer has an active voucher nearing expiry
    const existingClaim = await prisma.userCouponClaim.findFirst({
      where: { userId: buyer.id, couponId: expiringCoupon.id },
    });
    if (!existingClaim) {
      await prisma.userCouponClaim.create({
        data: {
          id: newId(),
          userId: buyer.id,
          couponId: expiringCoupon.id,
          claimedAt: now,
          isUsed: false,
        },
      });
      console.log(`🎟️ Claimed expiring coupon ${codeExpiring} for buyer.demo!`);
    }

    // 3. Expired coupon (Ended 5 days ago -> for testing expired tab)
    const codeExpired = `${prefix}OLD`;
    await prisma.shopCoupon.upsert({
      where: { shopId_code: { shopId: shop.id, code: codeExpired } },
      update: {
        isActive: false,
        endDate: new Date(now.getTime() - 5 * dayMs),
      },
      create: {
        id: newId(),
        shopId: shop.id,
        code: codeExpired,
        name: `คูปองเทศกาลเปิดฤดูกาล (หมดอายุแล้ว)`,
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 15,
        minSpendAmountMinor: 30000,
        maxDiscountAmountMinor: 15000,
        quota: 50,
        claimedCount: 50,
        usedCount: 45,
        startDate: new Date(now.getTime() - 20 * dayMs),
        endDate: new Date(now.getTime() - 5 * dayMs),
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    });

    console.log(`🏷️ Created 3 coupons (Active, Expiring in 2 days, and Expired)!`);
  }

  console.log(`\n🎉 ALL SHOPS SUCCESSFULLY SEEDED WITH FULL DASHBOARD DATA!`);
}

main().catch((error) => {
  console.error('Seed all sellers full dashboard failed:', error);
  process.exitCode = 1;
});
