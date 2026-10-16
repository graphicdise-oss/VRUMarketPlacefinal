import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const newId = () => uuidv7();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  console.log('💬 Seeding real, consistent chat rooms and messages for sellers...');

  const now = new Date();
  const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // 1. Fetch Buyer (สมใจ รักเรียน)
  const buyer = await prisma.user.findFirst({
    where: { email: 'buyer.demo@vru.ac.th' },
    include: { addresses: true },
  });
  if (!buyer) throw new Error('buyer.demo@vru.ac.th not found!');

  console.log(`👤 Buyer found: ${buyer.email} (${buyer.id})`);

  // 2. Fetch all shops and their owners
  const shops = await prisma.shop.findMany({
    include: {
      owner: true,
      products: { include: { variants: true } },
      orders: {
        where: { buyerId: buyer.id },
        orderBy: { createdAt: 'desc' },
        take: 3,
      },
    },
  });

  console.log(`Found ${shops.length} shops in database.`);

  for (const shop of shops) {
    if (!shop.owner) continue;

    console.log(`\n------------------------------------------------`);
    console.log(`🏪 Setting up chat for shop: "${shop.name}" (Owner: ${shop.owner.email})`);

    // Find or create ChatRoom between buyer and shopOwner
    let room = await prisma.chatRoom.findUnique({
      where: {
        buyerId_shopOwnerUserId: {
          buyerId: buyer.id,
          shopOwnerUserId: shop.owner.id,
        },
      },
    });

    const isHydroShop = shop.name.includes('สวนผักไฮโดร');
    const relatedOrder = shop.orders.find(o => o.status === 'PAID') || shop.orders[0];

    if (!room) {
      room = await prisma.chatRoom.create({
        data: {
          id: newId(),
          buyerId: buyer.id,
          shopOwnerUserId: shop.owner.id,
          createdAt: oneHourAgo,
          lastActivityAt: thirtyMinsAgo,
        },
      });
      console.log(`  ➕ Created new ChatRoom: ${room.id}`);
    } else {
      console.log(`  ℹ️ Found existing ChatRoom: ${room.id}`);
      // Clean up old messages for clean consistent state
      await prisma.chatMessage.deleteMany({ where: { roomId: room.id } });
      await prisma.chatRoomRead.deleteMany({ where: { roomId: room.id } });
    }

    // Determine message content tailored to this specific shop
    let messageContent = '';
    if (isHydroShop) {
      const orderShortId = relatedOrder ? relatedOrder.id.slice(0, 8) : '01a13609';
      messageContent = `สวัสดีค่ะ สอบถามคำสั่งซื้อผักสลัดไฮโดรโปนิกส์ (#${orderShortId}) ค่ะ ชำระเงินเรียบร้อยแล้ว พอดีเห็นสถานะรอจัดส่ง ทางร้านจะจัดส่งรอบบ่ายวันนี้ทันไหมคะ พอดีต้องใช้ทำสลัดพรุ่งนี้เช้าค่ะ`;
    } else if (shop.name.includes('ส้ม')) {
      messageContent = 'สวัสดีค่ะ สอบถามส้มสายน้ำผึ้งอินทรีย์ 5 กก. ที่สั่งไป จัดส่งรอบวันไหนคะ';
    } else if (shop.name.includes('จักสาน')) {
      messageContent = 'สวัสดีค่ะ กระเป๋าสานไม้ไผ่ที่สั่งไว้ งานประณีตมากเลยค่ะ ขอบคุณมากนะคะ';
    } else {
      messageContent = `สวัสดีค่ะ สอบถามสินค้าและคำสั่งซื้อในร้าน ${shop.name} ค่ะ มีของพร้อมส่งไหมคะ`;
    }

    // Create unread message from buyer
    const msg = await prisma.chatMessage.create({
      data: {
        id: newId(),
        roomId: room.id,
        senderId: buyer.id,
        content: messageContent,
        orderId: relatedOrder?.id || null,
        createdAt: thirtyMinsAgo,
      },
    });
    console.log(`  ✉️ Created unread message from buyer: "${msg.content.slice(0, 50)}..."`);

    // Buyer has read the room up to now
    await prisma.chatRoomRead.create({
      data: {
        id: newId(),
        roomId: room.id,
        userId: buyer.id,
        lastReadAt: now,
      },
    });

    // Shop owner has lastReadAt older than thirtyMinsAgo (e.g. oneHourAgo) -> 1 unread message!
    await prisma.chatRoomRead.create({
      data: {
        id: newId(),
        roomId: room.id,
        userId: shop.owner.id,
        lastReadAt: oneHourAgo,
      },
    });

    // Update room lastActivityAt
    await prisma.chatRoom.update({
      where: { id: room.id },
      data: { lastActivityAt: thirtyMinsAgo },
    });

    // Seed/Update CHAT_MESSAGE notification for the seller
    await prisma.notification.deleteMany({
      where: {
        userId: shop.owner.id,
        type: 'CHAT_MESSAGE',
      },
    });

    await prisma.notification.create({
      data: {
        id: newId(),
        userId: shop.owner.id,
        type: 'CHAT_MESSAGE',
        message: isHydroShop
          ? 'มีข้อความใหม่จาก คุณสมใจ รักเรียน สอบถามเกี่ยวกับคำสั่งซื้อผักสลัดไฮโดรโปนิกส์'
          : `มีข้อความใหม่จาก คุณสมใจ รักเรียน ในห้องแชทของร้าน ${shop.name}`,
        targetType: 'CHAT_ROOM',
        targetId: room.id,
        readAt: null, // Unread notification
        createdAt: thirtyMinsAgo,
      },
    });

    console.log(`  🔔 Created unread notification for seller (${shop.owner.email})`);
  }

  await prisma.$disconnect();
  console.log('\n🎉 ALL SHOPS SUCCESSFULLY SEEDED WITH REAL CONNECTED CHAT & NOTIFICATIONS!');
}

main().catch((err) => {
  console.error('Seed real chat failed:', err);
  process.exitCode = 1;
});
