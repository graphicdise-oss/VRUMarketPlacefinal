import { PrismaPg } from '../backend/Backend-VRU-Marketplace-main/node_modules/@prisma/adapter-pg/dist/index.js';
import { PrismaClient } from '../backend/Backend-VRU-Marketplace-main/node_modules/@prisma/client/default.js';

const connectionString = 'postgresql://postgres:VruMarket2026!@172.16.90.104:5433/vru_marketplace';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const userCount = await prisma.user.count();
    const productCount = await prisma.product.count();
    const shopCount = await prisma.shop.count();
    const orderCount = await prisma.order.count();
    console.log('✅ CONNECTED TO VM 104 DATABASE (172.16.90.104:5433)!');
    console.log(`Users: ${userCount}, Shops: ${shopCount}, Products: ${productCount}, Orders: ${orderCount}`);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
