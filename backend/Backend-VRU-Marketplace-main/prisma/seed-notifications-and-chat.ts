import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const newId = () => uuidv7();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  // 1. Fetch Users
  const buyer = await prisma.user.findFirst({
    where: { email: 'buyer.demo@vru.ac.th' },
  });
  const seller = await prisma.user.findFirst({
    where: { email: 'seller.demo@vru.ac.th' },
    include: { shops: true },
  });
  const seller2 = await prisma.user.findFirst({
    where: { email: 'seller2@vru.ac.th' },
    include: { shops: true },
  });

  if (!buyer || !seller) {
    console.error('Buyer or Seller not found!');
    return;
  }

  console.log(`👤 Buyer: ${buyer.email} (${buyer.id})`);
  console.log(`🏪 Seller: ${seller.email} (${seller.id}) - Shop: ${seller.shops[0]?.name}`);

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // Fetch some buyer orders for targetId references
  const buyerOrders = await prisma.order.findMany({
    where: { buyerId: buyer.id },
    take: 5,
  });

  // ─── 2. SEED NOTIFICATIONS ──────────────────────────────────────────
  // Clear old notifications for buyer and seller
  await prisma.notification.deleteMany({
    where: { userId: { in: [buyer.id, seller.id] } },
  });
  console.log('🗑️ Cleared existing notifications.');

  const buyerNotifications = [
    {
      id: newId(),
      userId: buyer.id,
      type: 'ORDER_STATUS',
      message: 'ร้านค้าสาธิต มรว. มาร์เก็ตเพลส ได้แจ้งค่าจัดส่งสำหรับคำสั่งซื้อของคุณแล้ว (ยอดชำระสุทธิ ฿223.00) กรุณาชำระเงินก่อนหมดเวลา',
      targetType: 'ORDER',
      targetId: buyerOrders[1]?.id || buyerOrders[0]?.id,
      readAt: null, // Unread notification
      createdAt: oneHourAgo,
    },
    {
      id: newId(),
      userId: buyer.id,
      type: 'ORDER_STATUS',
      message: 'ร้านค้าได้รับการชำระเงินและอนุมัติสลิปแล้ว กำลังเตรียมจัดส่งสินค้า ส้มสายน้ำผึ้งอินทรีย์พรีเมียม',
      targetType: 'ORDER',
      targetId: buyerOrders[3]?.id || buyerOrders[0]?.id,
      readAt: twoHoursAgo,
      createdAt: twoHoursAgo,
    },
    {
      id: newId(),
      userId: buyer.id,
      type: 'ORDER_STATUS',
      message: 'คำสั่งซื้อของคุณถูกจัดส่งแล้ว โดย Kerry Express หมายเลขพัสดุ KERRY-VRU-892174TH ตรวจสอบสถานะการจัดส่งได้ที่หน้าคำสั่งซื้อ',
      targetType: 'ORDER',
      targetId: buyerOrders[4]?.id || buyerOrders[0]?.id,
      readAt: oneDayAgo,
      createdAt: oneDayAgo,
    },
    {
      id: newId(),
      userId: buyer.id,
      type: 'ORDER_STATUS',
      message: 'คำสั่งซื้อ ข้าวหอมมะลิอินทรีย์ 105 ทุ่งวไลย สำเร็จเรียบร้อยแล้ว ขอบคุณที่สนับสนุนสินค้าชุมชน สามารถเขียนรีวิวสินค้าได้แล้วนะคะ',
      targetType: 'ORDER',
      targetId: buyerOrders[5]?.id || buyerOrders[0]?.id,
      readAt: twoDaysAgo,
      createdAt: twoDaysAgo,
    },
    {
      id: newId(),
      userId: buyer.id,
      type: 'GENERAL',
      message: 'ยินดีต้อนรับสู่ VRU Marketplace ตลาดสินค้าและนวัตกรรมชุมชน มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ฯ',
      targetType: null,
      targetId: null,
      readAt: twoDaysAgo,
      createdAt: twoDaysAgo,
    },
  ];

  for (const n of buyerNotifications) {
    await prisma.notification.create({ data: n });
  }
  console.log(`🔔 Seeded ${buyerNotifications.length} notifications for buyer.demo`);

  // Seller notifications
  const sellerNotifications = [
    {
      id: newId(),
      userId: seller.id,
      type: 'ORDER_STATUS',
      message: 'มีคำสั่งซื้อใหม่เข้ามา! กรุณาตรวจสอบและประเมินค่าจัดส่งให้ลูกค้าภายใน 24 ชั่วโมง',
      targetType: 'ORDER',
      targetId: buyerOrders[0]?.id,
      readAt: null,
      createdAt: oneHourAgo,
    },
    {
      id: newId(),
      userId: seller.id,
      type: 'ORDER_STATUS',
      message: 'ลูกค้าได้ส่งหลักฐานการโอนเงินแล้ว กรุณาตรวจสอบยอดเงินเข้าบัญชีและอนุมัติสลิปในหน้าจัดการคำสั่งซื้อ',
      targetType: 'ORDER',
      targetId: buyerOrders[2]?.id || buyerOrders[0]?.id,
      readAt: null,
      createdAt: twoHoursAgo,
    },
    {
      id: newId(),
      userId: seller.id,
      type: 'SHOP_APPROVED',
      message: 'ยินดีด้วย! ร้านค้า ร้านค้าสาธิต มรว. มาร์เก็ตเพลส ของคุณได้รับการอนุมัติเปิดร้านเรียบร้อยแล้ว',
      targetType: 'SHOP',
      targetId: seller.shops[0]?.id,
      readAt: twoDaysAgo,
      createdAt: twoDaysAgo,
    },
    {
      id: newId(),
      userId: seller.id,
      type: 'PRODUCT_APPROVED',
      message: 'สินค้า ส้มสายน้ำผึ้งอินทรีย์พรีเมียม ผ่านการอนุมัติและเผยแพร่บนหน้าร้านแล้ว',
      targetType: 'PRODUCT',
      targetId: null,
      readAt: twoDaysAgo,
      createdAt: twoDaysAgo,
    },
  ];

  for (const n of sellerNotifications) {
    await prisma.notification.create({ data: n });
  }
  console.log(`🔔 Seeded ${sellerNotifications.length} notifications for seller.demo`);

  // ─── 3. SEED CHAT ROOMS & MESSAGES ──────────────────────────────────
  // Clear old chat rooms for buyer and seller
  const existingRooms = await prisma.chatRoom.findMany({
    where: {
      OR: [
        { buyerId: buyer.id },
        { shopOwnerUserId: seller.id },
      ],
    },
  });

  for (const r of existingRooms) {
    await prisma.chatRoomRead.deleteMany({ where: { roomId: r.id } });
    await prisma.chatMessage.deleteMany({ where: { roomId: r.id } });
    await prisma.chatRoom.delete({ where: { id: r.id } });
  }
  console.log(`🗑️ Cleared ${existingRooms.length} old chat rooms.`);

  // Room 1: Buyer <-> Seller (ร้านค้าสาธิต มรว. มาร์เก็ตเพลส)
  const room1Id = newId();
  await prisma.chatRoom.create({
    data: {
      id: room1Id,
      buyerId: buyer.id,
      shopOwnerUserId: seller.id,
      createdAt: threeHoursAgo,
      lastActivityAt: oneHourAgo,
    },
  });

  const room1Messages = [
    {
      id: newId(),
      roomId: room1Id,
      senderId: buyer.id,
      content: 'สวัสดีครับ สนใจส้มสายน้ำผึ้งอินทรีย์กล่อง 5 กก. มีของพร้อมส่งไหมครับ',
      createdAt: new Date(now.getTime() - 3 * 3600 * 1000),
    },
    {
      id: newId(),
      roomId: room1Id,
      senderId: seller.id,
      content: 'สวัสดีค่ะ มีพร้อมส่งเลยค่ะ ส้มสดเพิ่งเก็บจากสวนชุมชน คัดเกรดพรีเมียมหวานฉ่ำทุกลูกเลยค่ะ',
      createdAt: new Date(now.getTime() - 2.8 * 3600 * 1000),
    },
    {
      id: newId(),
      roomId: room1Id,
      senderId: buyer.id,
      content: 'ถ้ากดสั่งซื้อตอนนี้ จะจัดส่งรอบวันไหนครับผม',
      createdAt: new Date(now.getTime() - 2.5 * 3600 * 1000),
    },
    {
      id: newId(),
      roomId: room1Id,
      senderId: seller.id,
      content: 'สั่งวันนี้ทางร้านแพ็คส่งให้รอบเช้าวันพรุ่งนี้เลยค่ะ ใช้ขนส่ง Kerry Express ประมาณ 1-2 วันถึงหน้าบ้านเลยค่ะ',
      createdAt: new Date(now.getTime() - 2 * 3600 * 1000),
    },
    {
      id: newId(),
      roomId: room1Id,
      senderId: seller.id,
      content: 'ทางร้านได้คำนวณและแจ้งค่าจัดส่งในระบบเรียบร้อยแล้วนะคะ สามารถตรวจสอบยอดชำระและโอนเงินในหน้าคำสั่งซื้อได้เลยค่ะ ขอบคุณมากนะคะ 🙏',
      orderId: buyerOrders[1]?.id || null,
      createdAt: oneHourAgo,
    },
  ];

  for (const m of room1Messages) {
    await prisma.chatMessage.create({ data: m });
  }

  // Room 1 Reads
  await prisma.chatRoomRead.create({
    data: {
      id: newId(),
      roomId: room1Id,
      userId: buyer.id,
      lastReadAt: now,
    },
  });
  await prisma.chatRoomRead.create({
    data: {
      id: newId(),
      roomId: room1Id,
      userId: seller.id,
      lastReadAt: oneHourAgo,
    },
  });
  console.log(`💬 Seeded Chat Room 1 (Buyer <-> ร้านค้าสาธิต มรว. มาร์เก็ตเพลส) with ${room1Messages.length} messages.`);

  // Room 2: Buyer <-> Seller 2 (ร้านจักสานไม้ไผ่หัตถศิลป์บางปะอิน) if seller2 exists
  if (seller2) {
    const room2Id = newId();
    await prisma.chatRoom.create({
      data: {
        id: room2Id,
        buyerId: buyer.id,
        shopOwnerUserId: seller2.id,
        createdAt: oneDayAgo,
        lastActivityAt: new Date(now.getTime() - 5 * 3600 * 1000),
      },
    });

    const room2Messages = [
      {
        id: newId(),
        roomId: room2Id,
        senderId: buyer.id,
        content: 'สวัสดีครับ กระเป๋าสานไม้ไผ่ทรงกระบอก ด้านในมีซับในผ้าฝ้ายไหมครับ',
        createdAt: oneDayAgo,
      },
      {
        id: newId(),
        roomId: room2Id,
        senderId: seller2.id,
        content: 'สวัสดีค่ะ มีซับในผ้าฝ้ายสีครีมอย่างดีเลยค่ะ มีช่องใส่ของด้านข้างด้วยนะคะ งานสานละเอียดแน่นหนามากค่ะ',
        createdAt: new Date(now.getTime() - 23 * 3600 * 1000),
      },
      {
        id: newId(),
        roomId: room2Id,
        senderId: buyer.id,
        content: 'ขอบคุณครับ สั่งซื้อเรียบร้อยแล้วนะครับ ฝากช่วยดูแลสินค้าด้วยครับ',
        createdAt: new Date(now.getTime() - 5 * 3600 * 1000),
      },
    ];

    for (const m of room2Messages) {
      await prisma.chatMessage.create({ data: m });
    }

    await prisma.chatRoomRead.create({
      data: {
        id: newId(),
        roomId: room2Id,
        userId: buyer.id,
        lastReadAt: now,
      },
    });
    console.log(`💬 Seeded Chat Room 2 (Buyer <-> ร้านจักสานไม้ไผ่หัตถศิลป์บางปะอิน) with ${room2Messages.length} messages.`);
  }

  console.log('🎉 Successfully seeded Notifications and Connected Chat for Buyer & Seller!');
}

main().catch((error: unknown) => {
  console.error('Seed notifications and chat failed:', error);
  process.exitCode = 1;
});
