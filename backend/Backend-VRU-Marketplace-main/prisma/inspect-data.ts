import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  const buyer = await prisma.user.findFirst({ where: { email: 'buyer.demo@vru.ac.th' } });
  console.log('Buyer:', buyer?.id, buyer?.email);

  const orders = await prisma.order.findMany({
    where: { buyerId: buyer?.id },
    include: { items: true, shop: true },
  });
  console.log('Existing orders count:', orders.length);
  for (const o of orders) {
    console.log(`- Order ${o.id.slice(0, 8)} status=${o.status} shop=${o.shop.name} total=${o.totalAmountMinor}`);
  }

  const shops = await prisma.shop.findMany({ take: 10 });
  console.log('Shops in DB:', shops.map(s => ({ id: s.id, name: s.name })));

  const products = await prisma.product.findMany({
    take: 10,
    include: { variants: true, images: true, shop: true },
  });
  console.log('Sample Products:', products.map(p => ({
    id: p.id,
    name: p.name,
    shopName: p.shop.name,
    variantId: p.variants[0]?.id,
    variantName: p.variants[0]?.name,
    price: p.variants[0]?.priceAmountMinor,
    images: p.images.length
  })));
}

main().catch(console.error);
