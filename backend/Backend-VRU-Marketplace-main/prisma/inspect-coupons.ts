import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function run() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const coupons = await prisma.shopCoupon.findMany({
      where: { isActive: true },
      include: { shop: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    console.log('Active coupons count:', coupons.length);
    for (const c of coupons) {
      console.log(JSON.stringify({
        id: c.id,
        shop: c.shop.name,
        code: c.code,
        name: c.name,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minSpendMinor: c.minSpendAmountMinor,
        maxDiscountMinor: c.maxDiscountAmountMinor,
        quota: c.quota,
        claimedCount: c.claimedCount,
        endDate: c.endDate,
      }));
    }
  } finally {
    await prisma.$disconnect();
  }
}

run().catch(console.error);
