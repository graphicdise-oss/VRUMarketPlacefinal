import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, CouponDiscountType, OrderStatus } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const newId = () => uuidv7();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  console.log('🎫 Seeding realistic coupons & promo codes...');

  const now = new Date();
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nextTwoMonths = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 1. Fetch shops
  const shops = await prisma.shop.findMany({
    include: { owner: true },
  });

  if (shops.length === 0 || !shops[0]) {
    console.error('No shops found! Please run seed-showcase first.');
    return;
  }

  const defaultShop = shops[0];
  const shopOrangeDemo = shops.find(s => s.owner?.email === 'seller.demo@vru.ac.th') ?? defaultShop;
  const shopTextile = shops.find(s => s.name.includes('ผ้าทอ')) ?? shops[3] ?? defaultShop;
  const shopCraft = shops.find(s => s.name.includes('จักสาน')) ?? shops[1] ?? defaultShop;
  const shopHerb = shops.find(s => s.name.includes('เฮิร์บ')) ?? shops[2] ?? defaultShop;
  const shopBakery = shops.find(s => s.owner?.email === 'seller5@vru.ac.th' || s.name.includes('เบเกอรี่')) ?? shops[4] ?? defaultShop;
  const shopHydro = shops.find(s => s.owner?.email === 'seller6@vru.ac.th' || s.name.includes('ไฮโดร')) ?? shops[5] ?? defaultShop;

  console.log(`🏪 Selected shops:
  - Orange Demo Shop (seller.demo): ${shopOrangeDemo.name} (${shopOrangeDemo.id})
  - Textile Shop: ${shopTextile.name} (${shopTextile.id})
  - Craft Shop: ${shopCraft.name} (${shopCraft.id})
  - Herb Shop: ${shopHerb.name} (${shopHerb.id})
  - Bakery Shop: ${shopBakery.name} (${shopBakery.id})
  - Hydro Farm Shop: ${shopHydro.name} (${shopHydro.id})`);

  // Clear existing coupons to prevent duplicate key error if re-run
  console.log('🧹 Cleaning existing coupons & claims...');
  await prisma.userCouponClaim.deleteMany({});
  await prisma.shopCoupon.deleteMany({});

  // 2. Create coupons for Shop Orange Demo (seller.demo@vru.ac.th)
  const couponDefs = [
    {
      shopId: shopOrangeDemo.id,
      code: 'ORANGE50',
      name: 'ส่วนลดพิเศษเปิดฤดูกาลส้มสายน้ำผึ้ง',
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountValue: 5000, // ฿50
      minSpendAmountMinor: 20000, // ขั้นต่ำ ฿200
      maxDiscountAmountMinor: null,
      quota: 100,
      claimedCount: 28,
      usedCount: 14,
      startDate: oneWeekAgo,
      endDate: nextMonth,
      isActive: true,
    },
    {
      shopId: shopOrangeDemo.id,
      code: 'VRU15',
      name: 'ลด 15% ฉลองสัปดาห์เกษตรอินทรีย์ มรว.',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 15, // 15%
      minSpendAmountMinor: 30000, // ขั้นต่ำ ฿300
      maxDiscountAmountMinor: 10000, // ลดสูงสุด ฿100
      quota: 50,
      claimedCount: 12,
      usedCount: 5,
      startDate: now,
      endDate: nextMonth,
      isActive: true,
    },
    {
      shopId: shopOrangeDemo.id,
      code: 'FRESH20',
      name: 'ลดทันที ฿20 ไม่มีขั้นต่ำ สำหรับลูกค้าใหม่',
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountValue: 2000, // ฿20
      minSpendAmountMinor: 0, // ไม่มีขั้นต่ำ
      maxDiscountAmountMinor: null,
      quota: 200,
      claimedCount: 85,
      usedCount: 42,
      startDate: oneWeekAgo,
      endDate: nextTwoMonths,
      isActive: true,
    },
    // Shop Textile
    {
      shopId: shopTextile.id,
      code: 'SILK50',
      name: 'ส่วนลดพิเศษเปิดตัวผ้าทอปทุมมาศ',
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountValue: 5000,
      minSpendAmountMinor: 20000,
      maxDiscountAmountMinor: null,
      quota: 100,
      claimedCount: 20,
      usedCount: 10,
      startDate: oneWeekAgo,
      endDate: nextMonth,
      isActive: true,
    },
    {
      shopId: shopTextile.id,
      code: 'TEXTILE20',
      name: 'ลดทันที ฿20 ไม่มีขั้นต่ำ สำหรับลูกค้าใหม่',
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountValue: 2000,
      minSpendAmountMinor: 0,
      maxDiscountAmountMinor: null,
      quota: 150,
      claimedCount: 60,
      usedCount: 30,
      startDate: oneWeekAgo,
      endDate: nextTwoMonths,
      isActive: true,
    },
    // Craft Shop
    {
      shopId: shopCraft.id,
      code: 'CRAFT10',
      name: 'ลด 10% งานจักสานหัตถศิลป์ไทย',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 10, // 10%
      minSpendAmountMinor: 40000, // ขั้นต่ำ ฿400
      maxDiscountAmountMinor: 15000, // สูงสุด ฿150
      quota: 40,
      claimedCount: 15,
      usedCount: 6,
      startDate: now,
      endDate: nextMonth,
      isActive: true,
    },
    {
      shopId: shopCraft.id,
      code: 'BAMBOO30',
      name: 'ส่วนลด ฿30 เมื่อซื้อผลิตภัณฑ์ไม้ไผ่',
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountValue: 3000, // ฿30
      minSpendAmountMinor: 25000, // ขั้นต่ำ ฿250
      maxDiscountAmountMinor: null,
      quota: 60,
      claimedCount: 22,
      usedCount: 8,
      startDate: now,
      endDate: nextMonth,
      isActive: true,
    },
    // Herb Shop
    {
      shopId: shopHerb.id,
      code: 'HERB25',
      name: 'ส่วนลดสมุนไพรและนวัตกรรมเพื่อสุขภาพ',
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountValue: 2500, // ฿25
      minSpendAmountMinor: 15000, // ขั้นต่ำ ฿150
      maxDiscountAmountMinor: null,
      quota: 80,
      claimedCount: 30,
      usedCount: 10,
      startDate: now,
      endDate: nextMonth,
      isActive: true,
    },
    // Bakery Shop (seller5)
    {
      shopId: shopBakery.id,
      code: 'BAKERY20',
      name: 'ส่วนลดของว่างและเบเกอรี่ชุมชน',
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountValue: 2000, // ฿20
      minSpendAmountMinor: 10000, // ขั้นต่ำ ฿100
      maxDiscountAmountMinor: null,
      quota: 80,
      claimedCount: 20,
      usedCount: 8,
      startDate: now,
      endDate: nextMonth,
      isActive: true,
    },
    // Hydro Farm Shop (seller6)
    {
      shopId: shopHydro.id,
      code: 'HYDRO15',
      name: 'ลด 15% ผักสลัดไฮโดรและผลไม้แปรรูป',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 15, // 15%
      minSpendAmountMinor: 20000, // ขั้นต่ำ ฿200
      maxDiscountAmountMinor: 10000, // สูงสุด ฿100
      quota: 100,
      claimedCount: 25,
      usedCount: 10,
      startDate: now,
      endDate: nextMonth,
      isActive: true,
    },
  ];

  const createdCoupons: Record<string, string> = {};

  for (const c of couponDefs) {
    const id = newId();
    await prisma.shopCoupon.create({
      data: {
        id,
        shopId: c.shopId,
        code: c.code,
        name: c.name,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minSpendAmountMinor: c.minSpendAmountMinor,
        maxDiscountAmountMinor: c.maxDiscountAmountMinor,
        quota: c.quota,
        claimedCount: c.claimedCount,
        usedCount: c.usedCount,
        startDate: c.startDate,
        endDate: c.endDate,
        isActive: c.isActive,
      },
    });
    createdCoupons[`${c.shopId}_${c.code}`] = id;
    if (c.shopId === shopOrangeDemo.id) {
      createdCoupons[c.code] = id;
    }
    console.log(`✅ Created coupon: ${c.code} (${c.name}) for shop ${c.shopId}`);
  }

  // 3. Pre-claim coupons for buyer.demo@vru.ac.th
  const buyer = await prisma.user.findFirst({
    where: { email: 'buyer.demo@vru.ac.th' },
  });

  if (buyer) {
    // Claim ORANGE50 from shopOrangeDemo (unclaimed/ready to use)
    const orange50Id = createdCoupons[`${shopOrangeDemo.id}_ORANGE50`];
    if (orange50Id) {
      await prisma.userCouponClaim.create({
        data: {
          id: newId(),
          userId: buyer.id,
          couponId: orange50Id,
          claimedAt: now,
          isUsed: false,
        },
      });
      console.log(`👤 Claimed ORANGE50 for ${buyer.email} (Ready to use)`);
    }

    // Claim VRU15 from shopOrangeDemo
    const vru15Id = createdCoupons[`${shopOrangeDemo.id}_VRU15`];
    if (vru15Id) {
      await prisma.userCouponClaim.create({
        data: {
          id: newId(),
          userId: buyer.id,
          couponId: vru15Id,
          claimedAt: now,
          isUsed: false,
        },
      });
      console.log(`👤 Claimed VRU15 for ${buyer.email} (Ready to use)`);
    }

    // Claim CRAFT10 from shopCraft
    const craft10Id = createdCoupons[`${shopCraft.id}_CRAFT10`];
    if (craft10Id) {
      await prisma.userCouponClaim.create({
        data: {
          id: newId(),
          userId: buyer.id,
          couponId: craft10Id,
          claimedAt: now,
          isUsed: false,
        },
      });
      console.log(`👤 Claimed CRAFT10 for ${buyer.email} (Ready to use)`);
    }

    // 4. Update an existing buyer order to have coupon discount applied!
    // Pick an order that already has shipping amount set and is confirmed/paid/completed
    const targetOrder = await prisma.order.findFirst({
      where: {
        buyerId: buyer.id,
        shippingAmountMinor: { not: null },
        status: { in: [OrderStatus.PAID, OrderStatus.COMPLETED, OrderStatus.SHIPPED] },
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    if (targetOrder) {
      const itemsTotal = targetOrder.items.reduce((s, it) => s + (it.priceAtPurchase * it.quantity), 0);
      const discountMinor = 5000; // ฿50
      const shippingMinor = targetOrder.shippingAmountMinor ?? 0;
      const netTotalMinor = Math.max(0, itemsTotal - discountMinor) + shippingMinor;

      await prisma.order.update({
        where: { id: targetOrder.id },
        data: {
          couponId: createdCoupons[`${shopOrangeDemo.id}_ORANGE50`] || createdCoupons['ORANGE50'] || null,
          couponCode: 'ORANGE50',
          discountAmountMinor: discountMinor,
          totalAmountMinor: netTotalMinor,
        },
      });

      console.log(`🧾 Updated order ${targetOrder.id} (${targetOrder.status}) with coupon ORANGE50 (-฿50.00), Net total: ฿${(netTotalMinor / 100).toFixed(2)}`);
    }

    // Also update a seller order for seller.demo@vru.ac.th
    const sellerDemo = await prisma.user.findFirst({
      where: { email: 'seller.demo@vru.ac.th' },
      include: { shops: true },
    });

    const sellerShop = sellerDemo?.shops?.[0] || shopOrangeDemo;
    if (sellerShop) {
      const orderToDiscount = await prisma.order.findFirst({
        where: {
          shopId: sellerShop.id,
          shippingAmountMinor: { not: null },
          status: { in: [OrderStatus.PAID, OrderStatus.COMPLETED, OrderStatus.SHIPPED] },
        },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      });

      if (orderToDiscount) {
        const sItemsTotal = orderToDiscount.items.reduce((s, it) => s + (it.priceAtPurchase * it.quantity), 0);
        const sDiscount = 5000; // ฿50
        const sShipping = orderToDiscount.shippingAmountMinor ?? 0;
        const sNetTotal = Math.max(0, sItemsTotal - sDiscount) + sShipping;

        await prisma.order.update({
          where: { id: orderToDiscount.id },
          data: {
            couponId: createdCoupons[`${sellerShop.id}_ORANGE50`] || createdCoupons['ORANGE50'] || null,
            couponCode: 'ORANGE50',
            discountAmountMinor: sDiscount,
            totalAmountMinor: sNetTotal,
          },
        });
        console.log(`🏪 Updated seller demo order ${orderToDiscount.id} with coupon ORANGE50 (-฿50.00)`);
      }
    }
  }

  console.log('\n🎉 COUPONS SEEDING FINISHED SUCCESSFULLY!');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
