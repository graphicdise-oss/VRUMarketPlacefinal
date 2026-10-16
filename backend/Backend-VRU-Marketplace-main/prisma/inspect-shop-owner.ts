import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function run() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const shop = await prisma.shop.findFirst({
      where: { name: 'สวนผักไฮโดรและผลไม้แปรรูปคลองหลวง' },
      include: { owner: true },
    });
    console.log('Shop ID:', shop?.id);
    console.log('Shop Name:', shop?.name);
    console.log('Owner User ID:', shop?.owner?.id);
    console.log('Owner User Email:', shop?.owner?.email);
    console.log('Owner User Name:', shop?.owner?.name);

    const buyer = await prisma.user.findFirst({ where: { email: 'buyer.demo@vru.ac.th' } });
    console.log('Buyer User ID:', buyer?.id);
    console.log('Buyer User Email:', buyer?.email);
    console.log('Buyer User Name:', buyer?.name);

    const rooms = await prisma.chatRoom.findMany({
      where: {
        OR: [
          { buyerId: buyer?.id },
          { shopOwnerUserId: shop?.ownerUser?.id },
        ],
      },
      include: {
        messages: true,
        reads: true,
      },
    });
    console.log('Found rooms count:', rooms.length);
    for (const r of rooms) {
      console.log(`- Room ${r.id}: buyerId=${r.buyerId}, shopOwnerUserId=${r.shopOwnerUserId}, messages=${r.messages.length}`);
      for (const m of r.messages) {
        console.log(`    Msg: sender=${m.senderId} text="${m.content}" created=${m.createdAt}`);
      }
      for (const rd of r.reads) {
        console.log(`    Read: user=${rd.userId} lastRead=${rd.lastReadAt}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

run().catch(console.error);
