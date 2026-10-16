import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  UserRole,
  ShopApprovalStatus,
  ProductModerationStatus,
  ShopPublishStatus,
  PaymentChannelType,
  OrderStatus,
} from '@prisma/client';
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
  console.log('🌱 Starting VRU Marketplace Showcase Seeding...');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run seed-showcase.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    // 1. Password Hashes
    console.log('🔑 Generating password hashes...');
    const superAdminHash = await hashPassword('SuperAdmin@VRU2026!');
    const communityAdminHash = await hashPassword('Admin@VRU2026');
    const sellerHash = await hashPassword('Seller@VRU2026');
    const buyerHash = await hashPassword('Buyer@VRU2026');

    // 2. Communities (4 Core Showcase Communities)
    console.log('🏘️ Setting up communities...');
    const communityDefs = [
      {
        name: 'วิสาหกิจชุมชนเกษตรอินทรีย์ มรว.',
        description: 'ศูนย์รวมผลผลิตเกษตรอินทรีย์ ผลไม้สด และสินค้าเกษตรปลอดภัยจากเครือข่ายแปลงทดลอง มรว.',
      },
      {
        name: 'วิสาหกิจชุมชนหัตถกรรมจักสานบางปะอิน',
        description: 'ภูมิปัญญางานจักสานไม้ไผ่ หวาย และกระจูด ลวดลายประณีตศิลป์ระดับพรีเมียม',
      },
      {
        name: 'กลุ่มแปรรูปผลิตภัณฑ์สมุนไพรและนวัตกรรม มรว.',
        description: 'ศูนย์พัฒนาและแปรรูปสมุนไพรพื้นบ้าน ผสานงานวิจัยและนวัตกรรมสุขภาพ มหาวิทยาลัยราชภัฏวไลยอลงกรณ์',
      },
      {
        name: 'ศูนย์ส่งเสริมผ้าทอพื้นเมืองปทุมธานี',
        description: 'อนุรักษ์และประยุกต์ผ้าทอมือลายเอกลักษณ์ ผ้าฝ้ายย้อมคราม และเครื่องแต่งกายร่วมสมัย',
      },
    ];

    const communities: Record<string, { id: string; name: string }> = {};
    for (const def of communityDefs) {
      let comm = await prisma.community.findFirst({ where: { name: def.name } });
      if (!comm) {
        comm = await prisma.community.create({
          data: {
            id: newId(),
            name: def.name,
            description: def.description,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      communities[def.name] = { id: comm.id, name: comm.name };
    }
    console.log(`✅ Ready 4 communities.`);

    // 3. Super Admin Users
    console.log('👑 Setting up Super Admins...');
    const superAdmins = ['superadmin@vru.ac.th', 'super@vru.ac.th'];
    let primarySuperAdminId = '';
    for (const email of superAdmins) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        await prisma.user.update({
          where: { email },
          data: {
            role: UserRole.SUPER_ADMIN,
            passwordHash: superAdminHash,
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
            email,
            role: UserRole.SUPER_ADMIN,
            passwordHash: superAdminHash,
            emailVerifiedAt: now,
            ageConfirmedAt: now,
            createdAt: now,
          },
        });
        if (!primarySuperAdminId) primarySuperAdminId = id;
      }
    }
    console.log(`✅ Super Admin ready (superadmin@vru.ac.th, super@vru.ac.th / SuperAdmin@VRU2026!)`);

    // 4. Community Admin User
    console.log('🏛️ Setting up Community Admin...');
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

    // Link Community Admin to ALL 4 communities
    for (const comm of Object.values(communities)) {
      const commId = comm.id;
      await prisma.communityAdmin.upsert({
        where: {
          userId_communityId: {
            userId: communityAdmin.id,
            communityId: commId,
          },
        },
        update: {},
        create: {
          id: newId(),
          userId: communityAdmin.id,
          communityId: commId,
          assignedBy: primarySuperAdminId,
          assignedAt: now,
        },
      });
    }
    console.log(`✅ Community Admin linked to all 4 communities (community.admin@vru.ac.th / Admin@VRU2026)`);

    // 5. Sellers & Shops Setup
    console.log('🏪 Setting up 6 Shops & Sellers...');
    const shopConfigs = [
      {
        sellerEmail: 'seller.demo@vru.ac.th',
        shopName: 'ร้านสวนส้มและเกษตรอินทรีย์ มรว.',
        desc: 'ผลไม้สด ผลผลิตเกษตรอินทรีย์ ปลูกด้วยวิถีธรรมชาติ ปลอดสารพิษ 100%',
        communityName: 'วิสาหกิจชุมชนเกษตรอินทรีย์ มรว.',
        province: 'ปทุมธานี',
        promptPay: '0811112222',
      },
      {
        sellerEmail: 'seller2@vru.ac.th',
        shopName: 'ร้านจักสานไม้ไผ่หัตถศิลป์บางปะอิน',
        desc: 'งานฝีมือจักสานไม้ไผ่ กระจูด และหวาย ภูมิปัญญาท้องถิ่นประยุกต์ร่วมสมัย',
        communityName: 'วิสาหกิจชุมชนหัตถกรรมจักสานบางปะอิน',
        province: 'พระนครศรีอยุธยา',
        promptPay: '0822223333',
      },
      {
        sellerEmail: 'seller3@vru.ac.th',
        shopName: 'วไลยเฮิร์บ สมุนไพรและนวัตกรรมเพื่อสุขภาพ',
        desc: 'ผลิตภัณฑ์สมุนไพรแปรรูป เวชสำอาง และผลงานนวัตกรรมสุขภาพ มรว.',
        communityName: 'กลุ่มแปรรูปผลิตภัณฑ์สมุนไพรและนวัตกรรม มรว.',
        province: 'ปทุมธานี',
        promptPay: '0833334444',
      },
      {
        sellerEmail: 'seller4@vru.ac.th',
        shopName: 'ร้านผ้าทอปทุมมาศ ลายเอกลักษณ์',
        desc: 'ผ้าฝ้ายย้อมคราม ผ้าคลุมไหล่ทอมือ และเครื่องแต่งกายลายโบราณร่วมสมัย',
        communityName: 'ศูนย์ส่งเสริมผ้าทอพื้นเมืองปทุมธานี',
        province: 'ปทุมธานี',
        promptPay: '0844445555',
      },
      {
        sellerEmail: 'seller5@vru.ac.th',
        shopName: 'ครกไม้เบเกอรี่และของว่างชุมชน มรว.',
        desc: 'ขนมขบเคี้ยว ของฝากแปรรูป และเบเกอรี่โฮมเมดจากวัตถุดิบชุมชน',
        communityName: 'กลุ่มแปรรูปผลิตภัณฑ์สมุนไพรและนวัตกรรม มรว.',
        province: 'ปทุมธานี',
        promptPay: '0855556666',
      },
      {
        sellerEmail: 'seller6@vru.ac.th',
        shopName: 'สวนผักไฮโดรและผลไม้แปรรูปคลองหลวง',
        desc: 'ผักสลัดไฮโดรโปนิกส์สดสะอาด น้ำผลไม้สกัดเข้มข้น และสินค้าเพื่อสุขภาพ',
        communityName: 'วิสาหกิจชุมชนเกษตรอินทรีย์ มรว.',
        province: 'ปทุมธานี',
        promptPay: '0866667777',
      },
    ];

    const shops: Record<string, { id: string; name: string; ownerId: string }> = {};

    for (const sc of shopConfigs) {
      let sellerUser = await prisma.user.findUnique({ where: { email: sc.sellerEmail } });
      if (sellerUser) {
        await prisma.user.update({
          where: { email: sc.sellerEmail },
          data: {
            passwordHash: sellerHash,
            emailVerifiedAt: now,
            ageConfirmedAt: now,
            bannedAt: null,
          },
        });
      } else {
        sellerUser = await prisma.user.create({
          data: {
            id: newId(),
            email: sc.sellerEmail,
            role: UserRole.USER,
            passwordHash: sellerHash,
            emailVerifiedAt: now,
            ageConfirmedAt: now,
            createdAt: now,
          },
        });
      }

      const fallbackComm = Object.values(communities)[0];
      if (!fallbackComm) throw new Error('No communities found');
      const commId = communities[sc.communityName]?.id ?? fallbackComm.id;

      let shop = await prisma.shop.findFirst({ where: { ownerId: sellerUser.id } });
      if (!shop) {
        shop = await prisma.shop.create({
          data: {
            id: newId(),
            ownerId: sellerUser.id,
            communityId: commId,
            name: sc.shopName,
            description: sc.desc,
            province: sc.province,
            approvalStatus: ShopApprovalStatus.APPROVED,
            closedAt: null,
            suspendedAt: null,
            createdAt: now,
          },
        });
      } else {
        await prisma.shop.update({
          where: { id: shop.id },
          data: {
            name: sc.shopName,
            description: sc.desc,
            province: sc.province,
            communityId: commId,
            approvalStatus: ShopApprovalStatus.APPROVED,
            closedAt: null,
            suspendedAt: null,
          },
        });
      }

      // PromptPay payment channel
      const pc = await prisma.paymentChannel.findFirst({ where: { shopId: shop.id } });
      if (!pc) {
        await prisma.paymentChannel.create({
          data: {
            id: newId(),
            shopId: shop.id,
            type: PaymentChannelType.PROMPTPAY,
            promptPayId: sc.promptPay,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      shops[sc.sellerEmail] = { id: shop.id, name: shop.name, ownerId: sellerUser.id };
    }
    console.log(`✅ 6 Shops ready with PromptPay.`);

    // 6. Categories Map
    console.log('📦 Resolving categories...');
    const allCategories = await prisma.category.findMany();
    const findCategory = (kw: string) => {
      const found = allCategories.find((c) => c.name.includes(kw));
      if (!found) throw new Error(`Category matching "${kw}" not found!`);
      return found.id;
    };

    const catFreshFood = findCategory('อาหารสด');
    const catProcessed = findCategory('แปรรูป');
    const catBeverage = findCategory('เครื่องดื่ม');
    const catAgri = findCategory('เกษตร');
    const catCraft = findCategory('ฝีมือ');
    const catClothing = findCategory('เสื้อผ้า');
    const catHealth = findCategory('สุขภาพ');
    const catHome = findCategory('ของใช้');
    const catInnovation = findCategory('นวัตกรรม');

    // 7. Products across all 9 categories
    console.log('🛍️ Populating showcase products for ALL 9 categories...');

    const productsCatalog = [
      // 1. อาหารสด/วัตถุดิบ
      {
        sellerEmail: 'seller.demo@vru.ac.th',
        name: 'ส้มสายน้ำผึ้งอินทรีย์พรีเมียม (กล่อง 5 กก.)',
        description: 'ส้มสายน้ำผึ้งรสหวานอมเปรี้ยวกลมกล่อม ปลูกด้วยวิถีอินทรีย์ ไม่ใช้สารเคมี ผิวสวย เนื้อแน่น ชุ่มฉ่ำ บรรจุกล่องลูกฟูกหนาพิเศษพร้อมโฟมกันกระแทก',
        categoryId: catFreshFood,
        variants: [
          { name: 'กล่องมาตรฐาน 5 กก. (เบอร์ 5)', priceAmountMinor: 35000, stock: 80 },
          { name: 'กล่องคัดพิเศษจัมโบ้ 5 กก. (เบอร์ 6)', priceAmountMinor: 42000, stock: 45 },
        ],
      },
      {
        sellerEmail: 'seller6@vru.ac.th',
        name: 'ผักสลัดไฮโดรโปนิกส์ ปลอดสารพิษ (ชุด 500 กรัม)',
        description: 'ผักสลัดสด กรอบ อร่อย ปลูกในระบบน้ำวนมาตรฐาน GAP เก็บเกี่ยวสดใหม่ทุกเช้า ปลอดภัย ไร้สารตกค้าง 100%',
        categoryId: catFreshFood,
        variants: [
          { name: 'ชุดรวม (กรีนโอ๊ค, เรดโอ๊ค, คอส, ฟิลเลย์)', priceAmountMinor: 8500, stock: 40 },
          { name: 'กรีนโอ๊ค ล้วน (500 กรัม)', priceAmountMinor: 8500, stock: 30 },
        ],
      },

      // 2. อาหารแปรรูป/ขนม
      {
        sellerEmail: 'seller5@vru.ac.th',
        name: 'กล้วยหอมทองอบกรอบเคลือบเนยวไลย (กระปุก 250 กรัม)',
        description: 'กล้วยหอมทองคัดพิเศษ อบกรอบด้วยลมร้อนไม่อมน้ำมัน เคลือบเนยสดแท้ หอม ละมุน หวานกำลังดี ปราศจากสารกันบูด',
        categoryId: catProcessed,
        variants: [
          { name: 'รสเนยสดดั้งเดิม', priceAmountMinor: 8900, stock: 100 },
          { name: 'รสปาปริก้าเข้มข้น', priceAmountMinor: 8900, stock: 75 },
        ],
      },
      {
        sellerEmail: 'seller5@vru.ac.th',
        name: 'น้ำพริกเผาเห็ดหอมสูตรสมุนไพรโบราณ (กระปุก 200 กรัม)',
        description: 'น้ำพริกเผาเห็ดหอมคัดสรรวัตถุดิบอินทรีย์ รสชาติเข้มข้น กลมกล่อม หอมกลิ่นกระทะ ไม่ใส่ผงชูรส ทานกับข้าวสวยหรือทำต้มยำก็อร่อย',
        categoryId: catProcessed,
        variants: [
          { name: 'สูตรเผ็ดกลาง', priceAmountMinor: 9500, stock: 60 },
          { name: 'สูตรมังสวิรัติ (ไม่ใส่กระเทียม)', priceAmountMinor: 9500, stock: 40 },
        ],
      },

      // 3. เครื่องดื่ม
      {
        sellerEmail: 'seller6@vru.ac.th',
        name: 'น้ำมัลเบอร์รี่อินทรีย์สกัดเข้มข้น 100% (500 มล.)',
        description: 'น้ำลูกหม่อนสดคั้นเข้มข้น อุดมด้วยสารต้านอนุมูลอิสระ แอนโทไซยานิน และวิตามินซีสูง รสเปรี้ยวอมหวานตามธรรมชาติ ดื่มสดชื่นทุกวัน',
        categoryId: catBeverage,
        variants: [
          { name: 'ขวดแก้ว 500 มล. (สูตรหวานน้อย)', priceAmountMinor: 15000, stock: 50 },
          { name: 'ขวดแก้ว 500 มล. (สูตรธรรมชาติ 100%)', priceAmountMinor: 16500, stock: 40 },
        ],
      },
      {
        sellerEmail: 'seller3@vru.ac.th',
        name: 'ชาเกสรดอกบัวหลวงอบแห้งอินทรีย์ มรว. (ซอง 50 กรัม)',
        description: 'เกสรดอกบัวหลวงแท้จากบึงบัวธรรมชาติ มรว. อบแห้งด้วยเทคโนโลยีอุณหภูมิต่ำ กลิ่นหอมสงบ ช่วยผ่อนคลาย บำรุงหัวใจ และช่วยให้หลับสบาย',
        categoryId: catBeverage,
        variants: [
          { name: 'ซองฟอยล์ซิปล็อค 50 กรัม', priceAmountMinor: 18000, stock: 70 },
        ],
      },

      // 4. ผลิตผลการเกษตร
      {
        sellerEmail: 'seller.demo@vru.ac.th',
        name: 'ข้าวหอมมะลิ 105 อินทรีย์ทุ่งวไลย (ถุง 5 กก.)',
        description: 'ข้าวหอมมะลิ 105 แท้ 100% จากแปลงนาสาธิตมหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ข้าวใหม่ต้นฤดู หอมนุ่ม หุงขึ้นหม้อ บรรจุถุงสุญญากาศรักษาคุณภาพ',
        categoryId: catAgri,
        variants: [
          { name: 'ถุง 5 กก. ซีลสุญญากาศ', priceAmountMinor: 22000, stock: 150 },
        ],
      },
      {
        sellerEmail: 'seller.demo@vru.ac.th',
        name: 'เมลอนญี่ปุ่นเนื้อเขียว หวานฉ่ำ คัดเกรดพิเศษ (ลูกละ 1.5-2 กก.)',
        description: 'เมลอนสายพันธุ์ญี่ปุ่นแท้ ปลูกในโรงเรือนควบคุมอุณหภูมิและศัตรูพืช ลายตาข่ายสวยงาม เนื้อนุ่ม หวานฉ่ำ ระดับความหวาน 14-16 บริกซ์',
        categoryId: catAgri,
        variants: [
          { name: 'เกรดพรีเมียม (1.5 - 1.8 กก.)', priceAmountMinor: 28000, stock: 35 },
          { name: 'เกรดจัมโบ้ (1.8 - 2.2 กก.)', priceAmountMinor: 34000, stock: 25 },
        ],
      },

      // 5. งานฝีมือ/ของที่ระลึก
      {
        sellerEmail: 'seller2@vru.ac.th',
        name: 'กระเป๋าสานกระจูดทรงพัด ลายพิกุลประยุกต์',
        description: 'กระเป๋าหัตถกรรมจักสานกระจูดเส้นละเอียด ฝีมือช่างจักสานบางปะอิน หูกระเป๋าหนังแท้ แข็งแรง ทนทาน เคลือบน้ำยาป้องกันเชื้อรา',
        categoryId: catCraft,
        variants: [
          { name: 'ไซส์ M (ขนาด 10x8 นิ้ว)', priceAmountMinor: 59000, stock: 25 },
          { name: 'ไซส์ L (ขนาด 13x10 นิ้ว)', priceAmountMinor: 75000, stock: 15 },
        ],
      },
      {
        sellerEmail: 'seller2@vru.ac.th',
        name: 'กล่องทิชชู่งานจักสานไม้ไผ่เคลือบเงา ลายสองชั้น',
        description: 'กล่องใส่กระดาษทิชชู่สานจากไม้ไผ่ย้อมสีธรรมชาติ ลวดลายประณีต สวยงาม เพิ่มความอบอุ่นสไตล์คราฟต์ให้กับโต๊ะอาหารและห้องรับแขก',
        categoryId: catCraft,
        variants: [
          { name: 'ขนาดมาตรฐาน (ทรงสี่เหลี่ยมผืนผ้า)', priceAmountMinor: 25000, stock: 50 },
        ],
      },

      // 6. เสื้อผ้า/เครื่องแต่งกาย
      {
        sellerEmail: 'seller4@vru.ac.th',
        name: 'เสื้อเชิ้ตผ้าฝ้ายเข็นมือ ย้อมครามธรรมชาติ มรว.',
        description: 'ผ้าฝ้ายทอมือเส้นใยธรรมชาติ 100% ย้อมสีครามแท้ ระบายอากาศได้ดีเยี่ยม ตัดเย็บประณีต สวมใส่สบาย ไม่ระคายเคืองผิว',
        categoryId: catClothing,
        variants: [
          { name: 'ไซส์ M (รอบอก 40 นิ้ว)', priceAmountMinor: 69000, stock: 20 },
          { name: 'ไซส์ L (รอบอก 42 นิ้ว)', priceAmountMinor: 69000, stock: 20 },
          { name: 'ไซส์ XL (รอบอก 44 นิ้ว)', priceAmountMinor: 72000, stock: 15 },
        ],
      },
      {
        sellerEmail: 'seller4@vru.ac.th',
        name: 'ผ้าคลุมไหล่ไหมประดิษฐ์ ทอมือลายบัวหลวงปทุมธานี',
        description: 'ผ้าคลุมไหล่เนื้อนุ่มพริ้ว ทอมือด้วยกี่โบราณ ลวดลายดอกบัวหลวงเอกลักษณ์เมืองปทุมธานี สีสันสุภาพ เหมาะสำหรับเป็นของฝากทรงคุณค่า',
        categoryId: catClothing,
        variants: [
          { name: 'โทนสีคราม-ฟ้าอมเทา', priceAmountMinor: 45000, stock: 30 },
          { name: 'โทนสีชมพูกลีบบัว', priceAmountMinor: 45000, stock: 30 },
        ],
      },

      // 7. สุขภาพและความงาม
      {
        sellerEmail: 'seller3@vru.ac.th',
        name: 'สบู่เปลือกมังคุดและน้ำผึ้งธรรมชาติ มรว. (ก้อน 100 กรัม)',
        description: 'สบู่กลีเซอรีนธรรมชาติ ผสานสารสกัดแทนนินจากเปลือกมังคุดช่วยลดการสะสมของแบคทีเรีย และน้ำผึ้งแท้บำรุงผิวให้นุ่มชุ่มชื้น ไม่แห้งตึง',
        categoryId: catHealth,
        variants: [
          { name: 'ก้อนเดี่ยว 100 กรัม', priceAmountMinor: 6500, stock: 120 },
          { name: 'แพ็ค 3 ก้อนสุดคุ้ม', priceAmountMinor: 17500, stock: 60 },
        ],
      },
      {
        sellerEmail: 'seller3@vru.ac.th',
        name: 'เซรั่มบำรุงผิวน้ำมันมะพร้าวสกัดเย็นบริสุทธิ์ (ขวดปั๊ม 50 มล.)',
        description: 'เซรั่มเนื้อบางเบา ซึมซาบเร็ว สกัดเย็นจากมะพร้าวอินทรีย์สวนสมาชิก อุดมด้วยกรดลอริกและวิตามินอี ช่วยฟื้นฟูผิวให้เปล่งปลั่งอย่างเป็นธรรมชาติ',
        categoryId: catHealth,
        variants: [
          { name: 'ขวดปั๊ม 50 มล.', priceAmountMinor: 29000, stock: 45 },
        ],
      },

      // 8. ของใช้ในบ้าน
      {
        sellerEmail: 'seller2@vru.ac.th',
        name: 'ตะกร้าหวายเก็บของอเนกประสงค์ สไตล์มินิมอล',
        description: 'ตะกร้าสานจากเส้นหวายแท้ธรรมชาติ แข็งแรงทนทาน แต่งบ้านสไตล์มูจิและเจแปนนิส จัดระเบียบสิ่งของได้อย่างลงตัว',
        categoryId: catHome,
        variants: [
          { name: 'ขนาดกลาง (กว้าง 25 ซม. สูง 20 ซม.)', priceAmountMinor: 38000, stock: 35 },
          { name: 'ขนาดใหญ่ (กว้าง 35 ซม. สูง 30 ซม.)', priceAmountMinor: 52000, stock: 20 },
        ],
      },
      {
        sellerEmail: 'seller5@vru.ac.th',
        name: 'เทียนหอมไขถั่วเหลือง กลิ่นข้าวหอมใหม่และไออุ่นดิน',
        description: 'เทียนหอมอโรมาผลิตจากไขถั่วเหลืองธรรมชาติ 100% ไร้ควันพิษ กลิ่นเอกลักษณ์ที่ได้แรงบันดาลใจจากทุ่งนารวงข้าว มรว. ให้บรรยากาศผ่อนคลาย',
        categoryId: catHome,
        variants: [
          { name: 'ตลับแก้ว 150 กรัม (จุดได้ 35 ชม.)', priceAmountMinor: 26000, stock: 40 },
        ],
      },

      // 9. นวัตกรรม มรว.
      {
        sellerEmail: 'seller3@vru.ac.th',
        name: 'สเปรย์กันยุงตะไคร้หอม สูตรนาโนแคปซูล มรว. (100 มล.)',
        description: 'นวัตกรรมสเปรย์กันยุงจากผลงานวิจัยมหาวิทยาลัยราชภัฏวไลยอลงกรณ์ เทคโนโลยีนาโนแคปซูลปลดปล่อยกลิ่นได้ยาวนานถึง 8 ชั่วโมง ไม่เหนียวเหนอะหนะ อ่อนโยนต่อผิวเด็ก',
        categoryId: catInnovation,
        variants: [
          { name: 'ขวดสเปรย์ 100 มล.', priceAmountMinor: 15900, stock: 150 },
          { name: 'ขวดรีฟิล 250 มล.', priceAmountMinor: 29900, stock: 80 },
        ],
      },
      {
        sellerEmail: 'seller3@vru.ac.th',
        name: 'เครื่องดื่มคอมบูชาโพรไบโอติกส์ สูตรวิจัยคณะวิทย์ มรว. (ขวด 250 มล.)',
        description: 'ชาหมักเพื่อสุขภาพคัดสรรสายพันธุ์จุลินทรีย์โพรไบโอติกส์ที่มีประโยชน์ต่อระบบลำไส้ รสชาติเปรี้ยวซ่าสดชื่น ดื่มง่าย มีสารต้านอนุมูลอิสระสูง',
        categoryId: catInnovation,
        variants: [
          { name: 'รสต้นตำรับชาดำอัสสัม', priceAmountMinor: 8500, stock: 90 },
          { name: 'รสลิ้นจี่และเกสรดอกบัว', priceAmountMinor: 9500, stock: 85 },
        ],
      },
    ];

    const seededVariants: Array<{ id: string; name: string; productName: string; priceMinor: number }> = [];

    for (const p of productsCatalog) {
      const targetShop = shops[p.sellerEmail];
      if (!targetShop) continue;

      let prod = await prisma.product.findFirst({
        where: { shopId: targetShop.id, name: p.name },
      });

      if (!prod) {
        const prodId = newId();
        prod = await prisma.product.create({
          data: {
            id: prodId,
            shopId: targetShop.id,
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
        await prisma.product.update({
          where: { id: prod.id },
          data: {
            categoryId: p.categoryId,
            description: p.description,
            moderationStatus: ProductModerationStatus.APPROVED,
            shopPublishStatus: ShopPublishStatus.PUBLISHED,
          },
        });
        const variants = await prisma.productVariant.findMany({ where: { productId: prod.id } });
        for (const v of variants) {
          seededVariants.push({ id: v.id, name: v.name, productName: p.name, priceMinor: v.priceAmountMinor });
        }
      }
    }
    console.log(`✅ Seeded ${productsCatalog.length} products across all 9 categories.`);

    // 8. Buyer User & Delivery Address
    console.log('👤 Setting up Buyer Account...');
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

    const subPostalCode = await prisma.subdistrictPostalCode.findFirst();
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
    console.log(`✅ Buyer ready (buyer.demo@vru.ac.th / Buyer@VRU2026)`);

    // 9. Sample Orders (PAID, SHIPPED, COMPLETED)
    console.log('📑 Creating sample orders across states...');
    const v1 = seededVariants[0];
    const v2 = seededVariants[2];
    const v3 = seededVariants[4];
    const shop1 = shops['seller1@vru.ac.th'];
    const shop2 = shops['seller5@vru.ac.th'];
    const shop3 = shops['seller6@vru.ac.th'];

    if (v1 && shop1) {
      const existingOrder1 = await prisma.order.findFirst({
        where: { buyerId: buyer.id, status: OrderStatus.PAID },
      });
      if (!existingOrder1) {
        const oId1 = newId();
        await prisma.order.create({
          data: {
            id: oId1,
            buyerId: buyer.id,
            shopId: shop1.id,
            status: OrderStatus.PAID,
            totalAmountMinor: v1.priceMinor + 5000,
            shippingAmountMinor: 5000,
            currency: 'THB',
            recipientName: 'สมชาย ใจดี',
            phone: '0812345678',
            houseNumber: '1 หมู่ 20 ถ.พหลโยธิน',
            subdistrictName: 'คลองหนึ่ง',
            districtName: 'คลองหลวง',
            provinceName: 'ปทุมธานี',
            postalCode: '13180',
            sellerConfirmedAt: now,
            sellerConfirmedBy: shop1.ownerId,
            createdAt: oneDayAgo,
            updatedAt: now,
          },
        });
        await prisma.orderItem.create({
          data: {
            id: newId(),
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
    }

    if (v2 && shop2) {
      const existingOrder2 = await prisma.order.findFirst({
        where: { buyerId: buyer.id, status: OrderStatus.SHIPPED },
      });
      if (!existingOrder2) {
        const oId2 = newId();
        await prisma.order.create({
          data: {
            id: oId2,
            buyerId: buyer.id,
            shopId: shop2.id,
            status: OrderStatus.SHIPPED,
            totalAmountMinor: v2.priceMinor + 4000,
            shippingAmountMinor: 4000,
            currency: 'THB',
            recipientName: 'สมชาย ใจดี',
            phone: '0812345678',
            houseNumber: '1 หมู่ 20 ถ.พหลโยธิน',
            subdistrictName: 'คลองหนึ่ง',
            districtName: 'คลองหลวง',
            provinceName: 'ปทุมธานี',
            postalCode: '13180',
            sellerConfirmedAt: threeDaysAgo,
            sellerConfirmedBy: shop2.ownerId,
            shippedAt: oneDayAgo,
            createdAt: threeDaysAgo,
            updatedAt: oneDayAgo,
          },
        });
        await prisma.orderItem.create({
          data: {
            id: newId(),
            orderId: oId2,
            variantId: v2.id,
            productNameAtPurchase: v2.productName,
            variantNameAtPurchase: v2.name,
            priceAtPurchase: v2.priceMinor,
            currency: 'THB',
            quantity: 1,
            createdAt: threeDaysAgo,
          },
        });
      }
    }

    if (v3 && shop3) {
      const existingOrder3 = await prisma.order.findFirst({
        where: { buyerId: buyer.id, status: OrderStatus.COMPLETED },
      });
      if (!existingOrder3) {
        const oId3 = newId();
        await prisma.order.create({
          data: {
            id: oId3,
            buyerId: buyer.id,
            shopId: shop3.id,
            status: OrderStatus.COMPLETED,
            totalAmountMinor: v3.priceMinor + 4500,
            shippingAmountMinor: 4500,
            currency: 'THB',
            recipientName: 'สมชาย ใจดี',
            phone: '0812345678',
            houseNumber: '1 หมู่ 20 ถ.พหลโยธิน',
            subdistrictName: 'คลองหนึ่ง',
            districtName: 'คลองหลวง',
            provinceName: 'ปทุมธานี',
            postalCode: '13180',
            sellerConfirmedAt: fiveDaysAgo,
            sellerConfirmedBy: shop3.ownerId,
            shippedAt: threeDaysAgo,
            completedAt: oneDayAgo,
            createdAt: fiveDaysAgo,
            updatedAt: oneDayAgo,
          },
        });
        await prisma.orderItem.create({
          data: {
            id: newId(),
            orderId: oId3,
            variantId: v3.id,
            productNameAtPurchase: v3.productName,
            variantNameAtPurchase: v3.name,
            priceAtPurchase: v3.priceMinor,
            currency: 'THB',
            quantity: 1,
            createdAt: fiveDaysAgo,
          },
        });
      }
    }
    console.log(`✅ Sample orders ready (PAID, SHIPPED, COMPLETED).`);

    // 10. Clean and Update Banners
    console.log('🖼️ Updating banner table with clean showcase banners...');
    // Remove any gibberish / draft test banner
    await prisma.banner.deleteMany({
      where: {
        OR: [
          { title: { contains: 'จจจ' } },
          { subtitle: { contains: 'ขขข' } },
        ],
      },
    }).catch(() => {});

    // Ensure clean showcase banners exist
    const bannerItems = [
      {
        displayOrder: 1,
        imageUrl: '/images/banner01.png',
        title: 'มหกรรมสินค้าชุมชน มรว.',
        subtitle: 'รวมของดีของเด่น ส่งตรงจากวิสาหกิจชุมชนสู่ผู้บริโภค',
        tag: 'โปรโมชันเด่น',
        linkUrl: '/products',
        isActive: true,
      },
      {
        displayOrder: 2,
        imageUrl: '/images/banner02.png',
        title: 'หัตถศิลป์และภูมิปัญญาท้องถิ่น',
        subtitle: 'งานจักสานและผ้าทอมือประณีต สร้างรายได้ยั่งยืนสู่ชุมชน',
        tag: 'งานฝีมือคุณภาพ',
        linkUrl: '/products',
        isActive: true,
      },
      {
        displayOrder: 3,
        imageUrl: '/images/banner03.png',
        title: 'นวัตกรรมและงานวิจัย มรว.',
        subtitle: 'ยกระดับผลิตภัณฑ์ชุมชนด้วยเทคโนโลยีและมาตรฐานระดับสากล',
        tag: 'นวัตกรรม มรว.',
        linkUrl: '/products',
        isActive: true,
      },
    ];

    for (const b of bannerItems) {
      const existingBanner = await prisma.banner.findFirst({ where: { displayOrder: b.displayOrder } });
      if (existingBanner) {
        await prisma.banner.update({
          where: { id: existingBanner.id },
          data: {
            imageUrl: b.imageUrl,
            title: b.title,
            subtitle: b.subtitle,
            tag: b.tag,
            linkUrl: b.linkUrl,
            isActive: b.isActive,
          },
        });
      } else {
        await prisma.banner.create({
          data: {
            id: newId(),
            displayOrder: b.displayOrder,
            imageUrl: b.imageUrl,
            title: b.title,
            subtitle: b.subtitle,
            tag: b.tag,
            linkUrl: b.linkUrl,
            isActive: b.isActive,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }
    console.log(`✅ Clean banners configured.`);

    console.log('\n🎉 SHOWCASE SEEDING COMPLETED SUCCESSFULLY!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exitCode = 1;
});
