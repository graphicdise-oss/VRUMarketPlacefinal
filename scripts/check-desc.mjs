import { PrismaPg } from '../backend/Backend-VRU-Marketplace-main/node_modules/@prisma/adapter-pg/dist/index.js';
import { PrismaClient } from '../backend/Backend-VRU-Marketplace-main/node_modules/@prisma/client/default.js';

const connectionString = 'postgresql://postgres:VruMarket2026!@172.16.90.104:5433/vru_marketplace';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const products = await prisma.product.findMany({
    select: {
      name: true,
      description: true,
      category: { select: { name: true } },
      shop: { select: { name: true } },
      moderationStatus: true
    },
    orderBy: { shopId: 'asc' }
  });
  
  for (const p of products) {
    console.log(`[${p.shop?.name}] "${p.name}" (${p.moderationStatus}) | Cat: ${p.category?.name}`);
    console.log(`  Desc: ${p.description}`);
  }
  const cats = await prisma.category.findMany();
  console.log('Categories:', cats.map(c => ({ id: c.id, name: c.name })));
  const shops = await prisma.shop.findMany({ select: { id: true, name: true } });
  console.log('Shops:', shops);
  await prisma.$disconnect();
}
main();
