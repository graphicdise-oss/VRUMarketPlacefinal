import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole, ShopApprovalStatus, ProductModerationStatus, ShopPublishStatus, PaymentChannelType, OrderStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { v7 as uuidv7 } from 'uuid';

const newId = (): string => uuidv7();

const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

async function main(): Promise<void> {
  console.log('🌱 Entering main()...');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run seed-staging.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    console.log('🌱 Starting VRU Marketplace Staging Seeding...');

    // 1. Password Hashes
    const superAdminHash = await hashPassword('SuperAdmin@VRU2026!');
    const communityAdminHash = await hashPassword('Admin@VRU2026');
    const sellerHash = await hashPassword('Seller@VRU2026');
    const buyerHash = await hashPassword('Buyer@VRU2026');

    // 2. Community
    let community = await prisma.community.findFirst({
      where: { name: 'วิสาหกิจชุมชนเกษตรอินทรีย์ มรว.' },
    });
    if (!community) {
      community = await prisma.community.create({
        data: {
          id: newId(),
          name: 'วิสาหกิจชุมชนเกษตรอินทรีย์ มรว.',
          description: 'ศูนย์รวมผลผลิตเกษตรอินทรีย์และสินค้าหัตถกรรมคุณภาพจากเครือข่ายชุมชน มหาวิทยาลัยราชภัฏวไลยอลงกรณ์',
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    console.log(`✅ Community ready: ${community.name}`);

    // 3. Super Admin Users
    const superAdminAccounts = [
      { email: 'superadmin@vru.ac.th', passwordHash: superAdminHash },
      { email: 'super@vru.ac.th', passwordHash: superAdminHash },
    ];
    let primarySuperAdminId = '';
    for (const acc of superAdminAccounts) {
      const existing = await prisma.user.findUnique({ where: { email: acc.email } });
      if (existing) {
        await prisma.user.update({
          where: { email: acc.email },
          data: {
            role: UserRole.SUPER_ADMIN,
            passwordHash: acc.passwordHash,
            emailVerifiedAt: now,
            ageConfirmedAt: now,
            bannedAt: null,
          },
        });
        if (!primarySuperAdminId) primarySuperAdminId = existing.id;
      } else {
        const id = newId();
        await prisma.user.create({
          data: {
            id,
            email: acc.email,
            role: UserRole.SUPER_ADMIN,
            passwordHash: acc.passwordHash,
            emailVerifiedAt: now,
            ageConfirmedAt: now,
            createdAt: now,
          },
        });
        if (!primarySuperAdminId) primarySuperAdminId = id;
      }
    }
    console.log(`✅ Super Admin accounts ready (superadmin@vru.ac.th, super@vru.ac.th)`);

    // 4. Community Admin User
    let communityAdmin = await prisma.user.findUnique({ where: { email: 'community.admin@vru.ac.th' } });
    if (communityAdmin) {
      await prisma.user.update({
        where: { email: 'community.admin@vru.ac.th' },
        data: {
          passwordHash: communityAdminHash,
          emailVerifiedAt: now,
          ageConfirmedAt: now,
          bannedAt: null,
        },
      });
    } else {
      communityAdmin = await prisma.user.create({
        data: {
          id: newId(),
          email: 'community.admin@vru.ac.th',
          role: UserRole.USER,
          passwordHash: communityAdminHash,
          emailVerifiedAt: now,
          ageConfirmedAt: now,
          createdAt: now,
        },
      });
    }

    // Link Community Admin to Community
    await prisma.communityAdmin.upsert({
      where: {
        userId_communityId: {
          userId: communityAdmin.id,
          communityId: community.id,
        },
      },
      update: {},
      create: {
        id: newId(),
        userId: communityAdmin.id,
        communityId: community.id,
        assignedBy: primarySuperAdminId,
        assignedAt: now,
      },
    });
    console.log(`✅ Community Admin ready: community.admin@vru.ac.th linked to ${community.name}`);

    // 5. Seller User & Shop
    let seller = await prisma.user.findUnique({ where: { email: 'seller.demo@vru.ac.th' } });
    if (seller) {
      await prisma.user.update({
        where: { email: 'seller.demo@vru.ac.th' },
        data: {
          passwordHash: sellerHash,
          emailVerifiedAt: now,
          ageConfirmedAt: now,
          bannedAt: null,
        },
      });
    } else {
      seller = await prisma.user.create({
        data: {
          id: newId(),
          email: 'seller.demo@vru.ac.th',
          role: UserRole.USER,
          passwordHash: sellerHash,
          emailVerifiedAt: now,
          ageConfirmedAt: now,
          createdAt: now,
        },
      });
    }

    let shop = await prisma.shop.findFirst({ where: { ownerId: seller.id } });
    if (!shop) {
      shop = await prisma.shop.create({
        data: {
          id: newId(),
          ownerId: seller.id,
          communityId: community.id,
          name: 'ร้านสวนส้มและเกษตรอินทรีย์ มรว.',
          description: 'ผลไม้สดและผลผลิตเกษตรอินทรีย์คุณภาพ ส่งตรงจากสวนสมาชิกชุมชน มหาวิทยาลัยราชภัฏวไลยอลงกรณ์',
          province: 'ปทุมธานี',
          approvalStatus: ShopApprovalStatus.APPROVED,
          createdAt: now,
        },
      });

      // Add PromptPay payment channel
      await prisma.paymentChannel.create({
        data: {
          id: newId(),
          shopId: shop.id,
          type: PaymentChannelType.PROMPTPAY,
          promptPayId: '0812345678',
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    console.log(`✅ Seller and Shop ready: ${shop.name}`);

    // 6. Categories
    const allCategories = await prisma.category.findMany();
    const fallbackCategory = allCategories[0];
    if (!fallbackCategory) {
      throw new Error('No categories found.');
    }
    const catFood = allCategories.find(c => c.name.includes('อาหารสด') || c.name.includes('วัตถุดิบ')) ?? fallbackCategory;
    const catAgri = allCategories.find(c => c.name.includes('เกษตร') || c.name.includes('ผลิตผล')) ?? fallbackCategory;
    const catProcessed = allCategories.find(c => c.name.includes('แปรรูป') || c.name.includes('ขนม')) ?? fallbackCategory;

    // 7. Seed Products with Variants
    const productsData = [
      {
        name: 'ส้มสายน้ำผึ้งอินทรีย์พรีเมียม (กล่อง 5 กก.)',
        description: 'ส้มสายน้ำผึ้งรสหวานอมเปรี้ยวกลมกล่อม ปลูกด้วยวิถีอินทรีย์ ไม่ใช้สารเคมี ผิวสวย เนื้อแน่น ชุ่มฉ่ำ บรรจุกล่องลูกฟูกหนาพิเศษพร้อมโฟมกันกระแทก',
        categoryId: catFood.id,
        variants: [
          { name: 'กล่องมาตรฐาน 5 กก. (เบอร์ 5)', priceAmountMinor: 35000, stock: 80 },
          { name: 'กล่องคัดพิเศษจัมโบ้ 5 กก. (เบอร์ 6)', priceAmountMinor: 42000, stock: 45 },
        ],
      },
      {
        name: 'ข้าวหอมมะลิอินทรีย์ทุ่งวไลย (ถุง 5 กก.)',
        description: 'ข้าวหอมมะลิ 105 แท้ 100% จากแปลงนาสาธิตมหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ข้าวใหม่ต้นฤดู หอมนุ่ม หุงขึ้นหม้อ บรรจุถุงสุญญากาศรักษาคุณภาพ',
        categoryId: catAgri.id,
        variants: [
          { name: 'ถุง 5 กก. ซีลสุญญากาศ', priceAmountMinor: 22000, stock: 120 },
        ],
      },
      {
        name: 'น้ำผึ้งดอกลำไยแท้ 100% ธรรมชาติ (750 มล.)',
        description: 'น้ำผึ้งแท้บริสุทธิ์จากเกสรดอกลำไย กลิ่นหอมหวานเป็นเอกลักษณ์ ผ่านกรรมวิธีควบคุมความชื้นมาตรฐาน สะอาด ปลอดภัย ไม่ผสมน้ำตาลหรือสารปรุงแต่ง',
        categoryId: catProcessed.id,
        variants: [
          { name: 'ขวดแก้ว 750 มล.', priceAmountMinor: 28000, stock: 60 },
        ],
      },
      {
        name: 'ผักสลัดไฮโดรโปนิกส์ ปลอดสารพิษ (ชุด 500 กรัม)',
        description: 'ผักสลัดสด กรอบ อร่อย ปลูกในระบบน้ำวนมาตรฐาน GAP เก็บเกี่ยวสดใหม่ทุกเช้า ปลอดภัย ไร้สารตกค้าง 100%',
        categoryId: catFood.id,
        variants: [
          { name: 'ชุดรวม (กรีนโอ๊ค, เรดโอ๊ค, คอส, ฟิลเลย์)', priceAmountMinor: 8500, stock: 35 },
        ],
      },
    ];

    const seededVariants: Array<{ id: string; name: string; productName: string; priceMinor: number }> = [];

    for (const p of productsData) {
      const existingProd = await prisma.product.findFirst({
        where: { shopId: shop.id, name: p.name },
      });

      let prodId = existingProd?.id;
      if (!existingProd) {
        prodId = newId();
        await prisma.product.create({
          data: {
            id: prodId,
            shopId: shop.id,
            categoryId: p.categoryId,
            name: p.name,
            description: p.description,
            moderationStatus: ProductModerationStatus.APPROVED,
            shopPublishStatus: ShopPublishStatus.PUBLISHED,
            createdAt: now,
            updatedAt: now,
          },
        });

        for (const v of p.variants) {
          const vId = newId();
          await prisma.productVariant.create({
            data: {
              id: vId,
              productId: prodId,
              name: v.name,
              priceAmountMinor: v.priceAmountMinor,
              stock: v.stock,
              currency: 'THB',
              createdAt: now,
              updatedAt: now,
            },
          });
          seededVariants.push({ id: vId, name: v.name, productName: p.name, priceMinor: v.priceAmountMinor });
        }
      } else {
        const variants = await prisma.productVariant.findMany({ where: { productId: existingProd.id } });
        for (const v of variants) {
          seededVariants.push({ id: v.id, name: v.name, productName: p.name, priceMinor: v.priceAmountMinor });
        }
      }
    }
    console.log(`✅ Seeded ${productsData.length} products with variants.`);

    // 8. Buyer User & Delivery Address
    let buyer = await prisma.user.findUnique({ where: { email: 'buyer.demo@vru.ac.th' } });
    if (buyer) {
      await prisma.user.update({
        where: { email: 'buyer.demo@vru.ac.th' },
        data: {
          passwordHash: buyerHash,
          emailVerifiedAt: now,
          ageConfirmedAt: now,
          bannedAt: null,
        },
      });
    } else {
      buyer = await prisma.user.create({
        data: {
          id: newId(),
          email: 'buyer.demo@vru.ac.th',
          role: UserRole.USER,
          passwordHash: buyerHash,
          emailVerifiedAt: now,
          ageConfirmedAt: now,
          createdAt: now,
        },
      });
    }

    // Lookup subdistrict postal code
    let subPostalCode = await prisma.subdistrictPostalCode.findFirst();
    if (!subPostalCode) {
      // Create minimal province/district/subdistrict/postalCode if empty
      const provId = newId();
      await prisma.province.create({ data: { id: provId, sourceCode: 13, nameTh: 'ปทุมธานี' } }).catch(() => {});
      const distId = newId();
      await prisma.district.create({ data: { id: distId, sourceCode: 1302, nameTh: 'คลองหลวง', provinceId: provId } }).catch(() => {});
      const subId = newId();
      await prisma.subdistrict.create({ data: { id: subId, sourceCode: 130201, nameTh: 'คลองหนึ่ง', districtId: distId } }).catch(() => {});
      const postCodeId = newId();
      subPostalCode = await prisma.subdistrictPostalCode.create({
        data: { id: postCodeId, subdistrictId: subId, postalCode: '13180' },
      }).catch(() => null);
      if (!subPostalCode) {
        subPostalCode = await prisma.subdistrictPostalCode.findFirst();
      }
    }

    if (subPostalCode) {
      const existingAddress = await prisma.address.findFirst({ where: { userId: buyer.id } });
      if (!existingAddress) {
        await prisma.address.create({
          data: {
            id: newId(),
            userId: buyer.id,
            recipientName: 'สมชาย ใจดี (ผู้ซื้อทดสอบ)',
            phone: '0812345678',
            houseNumber: '1 หมู่ 20 ถ.พหลโยธิน',
            subdistrictPostalCodeId: subPostalCode.id,
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }
    console.log(`✅ Buyer user ready: buyer.demo@vru.ac.th`);

    // 9. Shipping Carriers
    const carriers = await prisma.shippingCarrier.findMany();
    const kerryCarrier = carriers.find(c => c.name.toLowerCase().includes('kerry')) || carriers[0];
    const flashCarrier = carriers.find(c => c.name.toLowerCase().includes('flash')) || carriers[0];

    // 10. Sample Orders across states: PAID, SHIPPED, COMPLETED
    const v1 = seededVariants[0];
    const v2 = seededVariants[1];
    const v3 = seededVariants[2];

    if (v1 && v2 && v3) {

      // Order 1: PAID (Payment confirmed, awaiting shipment)
      const existingOrder1 = await prisma.order.findFirst({
        where: { buyerId: buyer.id, status: OrderStatus.PAID },
      });
      if (!existingOrder1) {
        const oId1 = newId();
        const oItem1 = newId();
        const shippingFee1 = 5000;
        const totalAmount1 = v1.priceMinor + shippingFee1;

        await prisma.order.create({
          data: {
            id: oId1,
            buyerId: buyer.id,
            shopId: shop.id,
            status: OrderStatus.PAID,
            totalAmountMinor: totalAmount1,
            shippingAmountMinor: shippingFee1,
            currency: 'THB',
            recipientName: 'สมชาย ใจดี',
            phone: '0812345678',
            houseNumber: '1 หมู่ 20 ถ.พหลโยธิน',
            subdistrictName: 'คลองหนึ่ง',
            districtName: 'คลองหลวง',
            provinceName: 'ปทุมธานี',
            postalCode: '13180',
            sellerConfirmedAt: now,
            sellerConfirmedBy: seller.id,
            createdAt: oneDayAgo,
            updatedAt: now,
          },
        });

        await prisma.orderItem.create({
          data: {
            id: oItem1,
            orderId: oId1,
            variantId: v1.id,
            productNameAtPurchase: v1.productName,
            variantNameAtPurchase: v1.name,
            priceAtPurchase: v1.priceMinor,
            currency: 'THB',
            quantity: 1,
            createdAt: oneDayAgo,
          },
        });
      }

      // Order 2: SHIPPED (In transit, has tracking number, buyer can click "Received")
      const existingOrder2 = await prisma.order.findFirst({
        where: { buyerId: buyer.id, status: OrderStatus.SHIPPED },
      });
      if (!existingOrder2) {
        const oId2 = newId();
        const oItem2 = newId();
        const shippingFee2 = 6000;
        const totalAmount2 = (v2.priceMinor * 2) + shippingFee2;

        await prisma.order.create({
          data: {
            id: oId2,
            buyerId: buyer.id,
            shopId: shop.id,
            status: OrderStatus.SHIPPED,
            totalAmountMinor: totalAmount2,
            shippingAmountMinor: shippingFee2,
            currency: 'THB',
            recipientName: 'สมชาย ใจดี',
            phone: '0812345678',
            houseNumber: '1 หมู่ 20 ถ.พหลโยธิน',
            subdistrictName: 'คลองหนึ่ง',
            districtName: 'คลองหลวง',
            provinceName: 'ปทุมธานี',
            postalCode: '13180',
            sellerConfirmedAt: twoDaysAgo,
            sellerConfirmedBy: seller.id,
            shippedAt: oneDayAgo,
            shippingCarrierId: kerryCarrier?.id,
            shippingCarrierNameAtShipment: kerryCarrier?.name || 'Kerry',
            trackingNumber: 'KERRY-VRU-987654',
            createdAt: twoDaysAgo,
            updatedAt: oneDayAgo,
          },
        });

        await prisma.orderItem.create({
          data: {
            id: oItem2,
            orderId: oId2,
            variantId: v2.id,
            productNameAtPurchase: v2.productName,
            variantNameAtPurchase: v2.name,
            priceAtPurchase: v2.priceMinor,
            currency: 'THB',
            quantity: 2,
            createdAt: twoDaysAgo,
          },
        });
      }

      // Order 3: COMPLETED (Delivered and finished)
      const existingOrder3 = await prisma.order.findFirst({
        where: { buyerId: buyer.id, status: OrderStatus.COMPLETED },
      });
      if (!existingOrder3) {
        const oId3 = newId();
        const oItem3 = newId();
        const shippingFee3 = 4000;
        const totalAmount3 = v3.priceMinor + shippingFee3;

        await prisma.order.create({
          data: {
            id: oId3,
            buyerId: buyer.id,
            shopId: shop.id,
            status: OrderStatus.COMPLETED,
            totalAmountMinor: totalAmount3,
            shippingAmountMinor: shippingFee3,
            currency: 'THB',
            recipientName: 'สมชาย ใจดี',
            phone: '0812345678',
            houseNumber: '1 หมู่ 20 ถ.พหลโยธิน',
            subdistrictName: 'คลองหนึ่ง',
            districtName: 'คลองหลวง',
            provinceName: 'ปทุมธานี',
            postalCode: '13180',
            sellerConfirmedAt: fourDaysAgo,
            sellerConfirmedBy: seller.id,
            shippedAt: twoDaysAgo,
            shippingCarrierId: flashCarrier?.id,
            shippingCarrierNameAtShipment: flashCarrier?.name || 'Flash',
            trackingNumber: 'FLASH-VRU-123456',
            completedAt: oneDayAgo,
            createdAt: fourDaysAgo,
            updatedAt: oneDayAgo,
          },
        });

        await prisma.orderItem.create({
          data: {
            id: oItem3,
            orderId: oId3,
            variantId: v3.id,
            productNameAtPurchase: v3.productName,
            variantNameAtPurchase: v3.name,
            priceAtPurchase: v3.priceMinor,
            currency: 'THB',
            quantity: 1,
            createdAt: fourDaysAgo,
          },
        });
      }
      console.log('✅ Seeded 3 sample orders in PAID, SHIPPED, and COMPLETED states.');
    }

    console.log('\n🎉 Staging Seeding Complete! Credentials summary:');
    console.log('====================================================');
    console.log('1. Super Admin:');
    console.log('   - Email:    superadmin@vru.ac.th (or super@vru.ac.th)');
    console.log('   - Password: SuperAdmin@VRU2026!');
    console.log('2. Community Admin:');
    console.log('   - Email:    community.admin@vru.ac.th');
    console.log('   - Password: Admin@VRU2026');
    console.log('3. Seller (Shop Owner):');
    console.log('   - Email:    seller.demo@vru.ac.th');
    console.log('   - Password: Seller@VRU2026');
    console.log('4. Buyer:');
    console.log('   - Email:    buyer.demo@vru.ac.th');
    console.log('   - Password: Buyer@VRU2026');
    console.log('====================================================\n');

  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('❌ Staging seed error:', error.message);
      if (error.stack) console.error(error.stack);
    } else {
      console.error('❌ Staging seed error:', error);
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
