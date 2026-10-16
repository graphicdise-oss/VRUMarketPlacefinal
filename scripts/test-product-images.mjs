import fs from 'fs';
import path from 'path';
import { PrismaPg } from '../backend/Backend-VRU-Marketplace-main/node_modules/@prisma/adapter-pg/dist/index.js';
import { PrismaClient } from '../backend/Backend-VRU-Marketplace-main/node_modules/@prisma/client/default.js';

import { getProductFallbackImage } from '../src/lib/product-mapper.ts';

const connectionString = 'postgresql://postgres:VruMarket2026!@172.16.90.104:5433/vru_marketplace';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      category: { select: { name: true } },
      shop: { select: { name: true } }
    },
    orderBy: { shopId: 'asc' }
  });

  console.log(`Checking ${products.length} products against image mapper:`);
  let allExist = true;

  for (const p of products) {
    const imgUrl = getProductFallbackImage(p.name, p.category?.name || '', p.description || '');
    const localRelPath = imgUrl.replace(/^\//, '');
    const localFullPath = path.join(process.cwd(), 'public', localRelPath);
    const exists = fs.existsSync(localFullPath);
    if (!exists) {
      console.error(`MISSING FILE: [${p.shop?.name}] "${p.name}" => ${imgUrl}`);
      allExist = false;
    } else {
      console.log(`OK: [${p.shop?.name}] "${p.name}" => ${imgUrl}`);
    }
  }

  await prisma.$disconnect();
  if (allExist) {
    console.log('\nALL 36 PRODUCTS SUCCESSFULLY MATCHED WITH LOCAL VALID IMAGES!');
  } else {
    process.exit(1);
  }
}
main();
