import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function run() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const orders = await prisma.order.findMany({
      where: { shop: { name: 'สวนผักไฮโดรและผลไม้แปรรูปคลองหลวง' } },
      include: { items: { include: { variant: true } }, buyer: true },
      orderBy: { createdAt: 'desc' },
    });
    console.log('Orders count:', orders.length);
    for (const o of orders) {
      console.log(JSON.stringify({
        id: o.id,
        buyerName: o.buyer.name || o.buyer.email,
        status: o.status,
        totalMinor: o.totalAmountMinor,
        createdAt: o.createdAt,
        items: o.items.map(it => ({ title: it.productTitleSnapshot, qty: it.quantity, price: it.priceAmountMinor }))
      }));
    }
  } finally {
    await prisma.$disconnect();
  }
}

run().catch(console.error);
