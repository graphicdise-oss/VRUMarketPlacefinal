import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const shop = await prisma.shop.findFirst({
    where: { name: 'สวนผักไฮโดรและผลไม้แปรรูปคลองหลวง' },
    include: { owner: true }
  });
  console.log('SHOP:', shop.name, 'OWNER ID:', shop.ownerId, 'OWNER EMAIL:', shop.owner.email);

  const orders = await prisma.order.findMany({
    where: { shopId: shop.id },
    include: {
      buyer: {
        select: {
          id: true,
          email: true,
          addresses: { select: { recipientName: true } }
        }
      }
    },
    take: 5
  });
  console.log('ORDERS COUNT:', orders.length);
  if (orders.length > 0) {
    console.log('FIRST ORDER BUYER:', orders[0].buyer);
    console.log('BUYER RECIPIENT NAME:', orders[0].recipientName);
  }

  // Check if room exists between this buyer and shop.ownerId
  if (orders.length > 0) {
    const room = await prisma.chatRoom.findUnique({
      where: {
        buyerId_shopOwnerUserId: {
          buyerId: orders[0].buyerId,
          shopOwnerUserId: shop.ownerId
        }
      }
    });
    console.log('EXISTING ROOM:', room);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
