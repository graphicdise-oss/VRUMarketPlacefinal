import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  const sellers = await prisma.user.findMany({
    where: { shops: { some: {} } },
    include: { shops: true },
  });

  console.log(`Found ${sellers.length} sellers with shops:`);
  for (const s of sellers) {
    const shop = s.shops[0];
    if (!shop) continue;
    const orderCount = await prisma.order.count({ where: { shopId: shop.id } });
    console.log(`- Seller: ${s.email} | Shop: "${shop.name}" (ID: ${shop.id.slice(0,8)}) | Orders: ${orderCount}`);
  }
}

main().catch((error: unknown) => {
  console.error('Check seller failed:', error);
  process.exitCode = 1;
});
