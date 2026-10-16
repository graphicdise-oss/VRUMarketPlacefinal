import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole, ShopApprovalStatus, ChatReportStatus, OrderStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { v7 as uuidv7 } from 'uuid';

const newId = (): string => uuidv7();

const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  console.log('🧪 Seeding QA scenarios for all 4 roles...');

  const now = new Date();
  const sellerHash = await hash('Seller@VRU2026', ARGON2_OPTIONS);

  // 1. Fetch Key Demo Users
  const buyer = await prisma.user.findFirst({ where: { email: 'buyer.demo@vru.ac.th' } });
  const sellerDemo = await prisma.user.findFirst({ where: { email: 'seller.demo@vru.ac.th' } });

  if (!buyer || !sellerDemo) {
    throw new Error('Buyer or Seller demo user not found.');
  }

  // 2. Scenario for Community Admin: PENDING Shop Application
  console.log('\n--- 1. PENDING Shop Application ---');
  let pendingSeller = await prisma.user.findFirst({ where: { email: 'seller.pending@vru.ac.th' } });
  if (!pendingSeller) {
    pendingSeller = await prisma.user.create({
      data: {
        id: newId(),
        email: 'seller.pending@vru.ac.th',
        passwordHash: sellerHash,
        role: UserRole.USER,
        emailVerifiedAt: now,
        createdAt: now,
      },
    });
    console.log('👤 Created pending seller account: seller.pending@vru.ac.th (Password: Seller@VRU2026)');
  }

  const community = await prisma.community.findFirst();
  if (community) {
    const existingPendingShop = await prisma.shop.findFirst({
      where: { ownerId: pendingSeller.id, approvalStatus: ShopApprovalStatus.PENDING },
    });
    if (!existingPendingShop) {
      await prisma.shop.create({
        data: {
          id: newId(),
          communityId: community.id,
          ownerId: pendingSeller.id,
          approvalStatus: ShopApprovalStatus.PENDING,
          name: 'ร้านเครื่องปั้นดินเผาและเบญจรงค์ มรว.',
          description: 'หัตถศิลป์เครื่องปั้นดินเผาและเบญจรงค์ลายไทยแท้ ผลิตโดยช่างฝีมือชุมชน',
          province: 'ปทุมธานี',
          createdAt: now,
        },
      });
      console.log('🏪 Created PENDING shop application for Community Admin review');
    } else {
      console.log('ℹ️ PENDING shop application already exists');
    }
  }

  // 3. Scenario for Super Admin: PENDING Community Request
  console.log('\n--- 2. PENDING Community Request ---');
  const existingPendingCommReq = await prisma.communityRequest.findFirst({
    where: { status: 'PENDING' },
  });
  if (!existingPendingCommReq) {
    await prisma.communityRequest.create({
      data: {
        id: newId(),
        name: 'ชุมชนคนรักกาแฟโบราณและของหวานคลองหนึ่ง',
        description: 'ขอจัดตั้งกลุ่มวิสาหกิจชุมชนกาแฟโบราณและขนมหวานพื้นบ้าน มรว. เพื่อส่งเสริมอาชีพในท้องถิ่น',
        location: 'ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี',
        requesterId: buyer.id,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      },
    });
    console.log('🏛️ Created PENDING community request for Super Admin review');
  } else {
    console.log('ℹ️ PENDING community request already exists');
  }

  // 4. Scenario for Community Admin: Active Dispute
  console.log('\n--- 3. Active Order Dispute ---');
  const refundOrder = await prisma.order.findFirst({
    where: {
      buyerId: buyer.id,
      status: OrderStatus.REFUND_ORDERED,
    },
    include: { shop: true },
  });

  if (refundOrder) {
    const existingDispute = await prisma.dispute.findFirst({
      where: { orderId: refundOrder.id },
    });
    if (!existingDispute) {
      await prisma.dispute.create({
        data: {
          id: newId(),
          orderId: refundOrder.id,
          shopId: refundOrder.shopId,
          openedBy: buyer.id,
          reason: 'สินค้าแตกหักเสียหายระหว่างการขนส่ง และสินค้าไม่ตรงกับที่ระบุในรายการสั่งซื้อ',
          shopResponse: 'ทางร้านต้องกราบขออภัยในความไม่สะดวกอย่างยิ่ง กำลังประสานงานบริษัทขนส่งเพื่อตรวจสอบและพร้อมเปลี่ยนสินค้าให้ครับ',
          respondedAt: new Date(now.getTime() - 6 * 3600 * 1000),
          createdAt: new Date(now.getTime() - 24 * 3600 * 1000),
          updatedAt: new Date(now.getTime() - 6 * 3600 * 1000),
        },
      });
      console.log(`⚖️ Created active dispute for order ${refundOrder.id} (${refundOrder.shop.name})`);
    } else {
      console.log('ℹ️ Dispute already exists for order');
    }
  } else {
    console.warn('⚠️ No REFUND_ORDERED order found to attach dispute');
  }

  // 5. Scenario for Super Admin: Chat Report
  console.log('\n--- 4. Chat Abuse Report ---');
  const chatRoom = await prisma.chatRoom.findFirst({
    where: { buyerId: buyer.id },
    include: { messages: true },
  });

  const firstMsg = chatRoom?.messages[0];
  if (chatRoom && firstMsg) {
    const message = firstMsg;
    const existingReport = await prisma.chatReport.findFirst({
      where: { roomId: chatRoom.id },
    });
    if (!existingReport) {
      await prisma.chatReport.create({
        data: {
          id: newId(),
          reporterId: buyer.id,
          reportedId: chatRoom.shopOwnerUserId,
          roomId: chatRoom.id,
          messageId: message.id,
          reason: 'มีพฤติกรรมใช้ถ้อยคำไม่สุภาพ',
          details: 'ผู้ขายตอบกลับข้อความสอบถามด้วยถ้อยคำที่ไม่เหมาะสมและเสียดสี',
          status: ChatReportStatus.PENDING,
          createdAt: now,
        },
      });
      console.log('🚨 Created PENDING chat report for Super Admin moderation');
    } else {
      console.log('ℹ️ Chat report already exists');
    }
  } else {
    console.warn('⚠️ No chat room or message found to attach report');
  }

  // 6. Scenario for Buyer: Cart Items
  console.log('\n--- 5. Buyer Shopping Cart ---');
  let cart = await prisma.cart.findUnique({ where: { userId: buyer.id } });
  if (!cart) {
    cart = await prisma.cart.create({
      data: {
        id: newId(),
        userId: buyer.id,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  // Add 2 distinct purchasable variants to buyer's cart
  const approvedVariants = await prisma.productVariant.findMany({
    where: {
      deletedAt: null,
      stock: { gt: 5 },
      product: {
        deletedAt: null,
        moderationStatus: 'APPROVED',
      },
    },
    include: { product: true },
    take: 3,
  });

  if (approvedVariants.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    for (const v of approvedVariants.slice(0, 2)) {
      await prisma.cartItem.create({
        data: {
          id: newId(),
          cartId: cart.id,
          variantId: v.id,
          quantity: 2,
          priceAmountMinorWhenAdded: v.priceAmountMinor,
          productNameWhenAdded: v.product.name,
          variantNameWhenAdded: v.name,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    console.log(`🛒 Populated buyer's cart with ${Math.min(2, approvedVariants.length)} items for checkout testing`);
  }

  // 7. Scenario for Buyer: Wishlist / Favorites
  console.log('\n--- 6. Buyer Favorites ---');
  const favProducts = await prisma.product.findMany({
    where: {
      deletedAt: null,
      moderationStatus: 'APPROVED',
    },
    take: 3,
  });

  if (favProducts.length > 0) {
    await prisma.favorite.deleteMany({ where: { userId: buyer.id } });
    for (const p of favProducts) {
      await prisma.favorite.create({
        data: {
          id: newId(),
          userId: buyer.id,
          productId: p.id,
          createdAt: now,
        },
      });
    }
    console.log(`❤️ Added ${favProducts.length} favorite products for buyer`);
  }

  console.log('\n✨ All QA scenarios seeded successfully!');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Seeding QA scenarios failed:', err);
  process.exit(1);
});
