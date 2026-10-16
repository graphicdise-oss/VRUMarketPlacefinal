import { PrismaPg } from '../backend/Backend-VRU-Marketplace-main/node_modules/@prisma/adapter-pg/dist/index.js';
import { PrismaClient } from '../backend/Backend-VRU-Marketplace-main/node_modules/@prisma/client/default.js';

const connectionString = 'postgresql://postgres:VruMarket2026!@172.16.90.104:5433/vru_marketplace';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      moderationStatus: true,
      category: { select: { name: true } },
      shop: { select: { name: true } },
      images: { select: { id: true } }
    },
    orderBy: { shopId: 'asc' }
  });
  console.log('Total products in DB:', products.length);
  for (const p of products) {
    console.log(`- [${p.shop?.name}] ${p.name} | Cat: ${p.category?.name} | Status: ${p.moderationStatus} | Images: ${p.images?.length}`);
  }
  await prisma.$disconnect();
}
main();
