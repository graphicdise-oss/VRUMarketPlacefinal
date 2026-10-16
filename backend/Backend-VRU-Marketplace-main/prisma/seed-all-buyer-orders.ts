import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, OrderStatus, OrderCancelledBy } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const newId = () => uuidv7();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  const buyer = await prisma.user.findFirst({
    where: { email: 'buyer.demo@vru.ac.th' },
  });

  if (!buyer) {
    console.error('Buyer buyer.demo@vru.ac.th not found!');
    return;
  }

  console.log(`👤 Found buyer: ${buyer.id} (${buyer.email})`);

  // Clear existing orders for buyer.demo so we have a clean, pristine set for all 7 statuses
  await prisma.orderItem.deleteMany({
    where: { order: { buyerId: buyer.id } },
  });
  await prisma.paymentSlip.deleteMany({
    where: { order: { buyerId: buyer.id } },
  });
  await prisma.order.deleteMany({
    where: { buyerId: buyer.id },
  });
  console.log('🗑️ Cleared old orders for buyer.demo.');

  // Fetch shops
  const allShops = await prisma.shop.findMany({
    include: { products: { include: { variants: true } } },
  });
  console.log(`🏪 Found ${allShops.length} shops.`);

  const carriers = await prisma.shippingCarrier.findMany();
  const kerry = carriers.find(c => c.name.toLowerCase().includes('kerry')) || carriers[0];
  const flash = carriers.find(c => c.name.toLowerCase().includes('flash')) || carriers[1] || carriers[0];

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  const defaultAddress = {
    recipientName: 'สมชาย ใจดี',
    phone: '0812345678',
    houseNumber: '1 หมู่ 20 ถ.พหลโยธิน',
    subdistrictName: 'คลองหนึ่ง',
    districtName: 'คลองหลวง',
    provinceName: 'ปทุมธานี',
    postalCode: '13180',
    currency: 'THB',
  };

  const getShopAndProduct = (idx: number, nameMatch?: string) => {
    const shop = (nameMatch ? allShops.find(s => s.name.includes(nameMatch)) : undefined) ?? allShops[idx] ?? allShops[0];
    if (!shop) throw new Error('No shop available to seed orders');
    const prod = shop.products[0] ?? allShops[0]?.products[0];
    if (!prod) throw new Error(`No product found in shop ${shop.name}`);
    const variant = prod.variants[0];
    if (!variant) throw new Error(`No variant found in product ${prod.name}`);
    return { shop, prod, variant };
  };

  // 1. AWAITING_SHIPPING_QUOTE (รอค่าส่ง)
  const { shop: shop1, prod: prod1, variant: v1 } = getShopAndProduct(0, 'จักสาน');
  const o1Id = newId();
  await prisma.order.create({
    data: {
      id: o1Id,
      buyerId: buyer.id,
      shopId: shop1.id,
      status: OrderStatus.AWAITING_SHIPPING_QUOTE,
      totalAmountMinor: null,
      shippingAmountMinor: null,
      shippingQuoteWindowStartedAt: twoHoursAgo,
      createdAt: twoHoursAgo,
      updatedAt: twoHoursAgo,
      ...defaultAddress,
    },
  });
  await prisma.orderItem.create({
    data: {
      id: newId(),
      orderId: o1Id,
      variantId: v1.id,
      productNameAtPurchase: prod1.name,
      variantNameAtPurchase: v1.name,
      priceAtPurchase: v1.priceAmountMinor,
      currency: 'THB',
      quantity: 1,
      createdAt: twoHoursAgo,
    },
  });
  console.log(`✅ Order 1 (AWAITING_SHIPPING_QUOTE) created at ${shop1.name}`);

  // 2. AWAITING_PAYMENT (ที่ต้องชำระ)
  const { shop: shop2, prod: prod2, variant: v2 } = getShopAndProduct(1, 'เบเกอรี่');
  const o2Id = newId();
  const shippingFee2 = 4500;
  const itemTotal2 = v2.priceAmountMinor * 2;
  await prisma.order.create({
    data: {
      id: o2Id,
      buyerId: buyer.id,
      shopId: shop2.id,
      status: OrderStatus.AWAITING_PAYMENT,
      shippingAmountMinor: shippingFee2,
      totalAmountMinor: itemTotal2 + shippingFee2,
      shippingQuoteWindowStartedAt: sixHoursAgo,
      paymentWindowStartedAt: fourHoursAgo,
      createdAt: sixHoursAgo,
      updatedAt: fourHoursAgo,
      ...defaultAddress,
    },
  });
  await prisma.orderItem.create({
    data: {
      id: newId(),
      orderId: o2Id,
      variantId: v2.id,
      productNameAtPurchase: prod2.name,
      variantNameAtPurchase: v2.name,
      priceAtPurchase: v2.priceAmountMinor,
      currency: 'THB',
      quantity: 2,
      createdAt: sixHoursAgo,
    },
  });
  console.log(`✅ Order 2 (AWAITING_PAYMENT) created at ${shop2.name}`);

  // 3. PAYMENT_SUBMITTED (รอยืนยันสลิป)
  const { shop: shop3, prod: prod3, variant: v3 } = getShopAndProduct(2, 'สมุนไพร');
  const o3Id = newId();
  const shippingFee3 = 4000;
  const itemTotal3 = v3.priceAmountMinor * 2;
  await prisma.order.create({
    data: {
      id: o3Id,
      buyerId: buyer.id,
      shopId: shop3.id,
      status: OrderStatus.PAYMENT_SUBMITTED,
      shippingAmountMinor: shippingFee3,
      totalAmountMinor: itemTotal3 + shippingFee3,
      paymentWindowStartedAt: sixHoursAgo,
      paymentConfirmationWindowStartedAt: twoHoursAgo,
      createdAt: sixHoursAgo,
      updatedAt: twoHoursAgo,
      ...defaultAddress,
    },
  });
  await prisma.orderItem.create({
    data: {
      id: newId(),
      orderId: o3Id,
      variantId: v3.id,
      productNameAtPurchase: prod3.name,
      variantNameAtPurchase: v3.name,
      priceAtPurchase: v3.priceAmountMinor,
      currency: 'THB',
      quantity: 2,
      createdAt: sixHoursAgo,
    },
  });
  console.log(`✅ Order 3 (PAYMENT_SUBMITTED) created at ${shop3.name}`);

  // 4. PAID (ที่ต้องจัดส่ง)
  const { shop: shop4, prod: prod4, variant: v4 } = getShopAndProduct(3, 'เกษตร');
  const o4Id = newId();
  const shippingFee4 = 5000;
  const itemTotal4 = v4.priceAmountMinor;
  await prisma.order.create({
    data: {
      id: o4Id,
      buyerId: buyer.id,
      shopId: shop4.id,
      status: OrderStatus.PAID,
      shippingAmountMinor: shippingFee4,
      totalAmountMinor: itemTotal4 + shippingFee4,
      paymentWindowStartedAt: oneDayAgo,
      paymentConfirmationWindowStartedAt: oneDayAgo,
      sellerConfirmedAt: fourHoursAgo,
      sellerConfirmedBy: shop4.ownerId,
      createdAt: oneDayAgo,
      updatedAt: fourHoursAgo,
      ...defaultAddress,
    },
  });
  await prisma.orderItem.create({
    data: {
      id: newId(),
      orderId: o4Id,
      variantId: v4.id,
      productNameAtPurchase: prod4.name,
      variantNameAtPurchase: v4.name,
      priceAtPurchase: v4.priceAmountMinor,
      currency: 'THB',
      quantity: 1,
      createdAt: oneDayAgo,
    },
  });
  console.log(`✅ Order 4 (PAID) created at ${shop4.name}`);

  // 5. SHIPPED (กำลังจัดส่ง)
  const { shop: shop5, prod: prod5, variant: v5 } = getShopAndProduct(4, 'คลองหลวง');
  const o5Id = newId();
  const shippingFee5 = 5000;
  const itemTotal5 = v5.priceAmountMinor * 2;
  await prisma.order.create({
    data: {
      id: o5Id,
      buyerId: buyer.id,
      shopId: shop5.id,
      status: OrderStatus.SHIPPED,
      shippingAmountMinor: shippingFee5,
      totalAmountMinor: itemTotal5 + shippingFee5,
      sellerConfirmedAt: twoDaysAgo,
      sellerConfirmedBy: shop5.ownerId,
      shippedAt: oneDayAgo,
      shippingCarrierId: kerry?.id,
      shippingCarrierNameAtShipment: kerry?.name || 'Kerry Express',
      trackingNumber: 'KERRY-VRU-892174TH',
      createdAt: threeDaysAgo,
      updatedAt: oneDayAgo,
      ...defaultAddress,
    },
  });
  await prisma.orderItem.create({
    data: {
      id: newId(),
      orderId: o5Id,
      variantId: v5.id,
      productNameAtPurchase: prod5.name,
      variantNameAtPurchase: v5.name,
      priceAtPurchase: v5.priceAmountMinor,
      currency: 'THB',
      quantity: 2,
      createdAt: threeDaysAgo,
    },
  });
  console.log(`✅ Order 5 (SHIPPED) created at ${shop5.name}`);

  // 6. COMPLETED (เสร็จสิ้น)
  const { shop: shop6, prod: prod6, variant: v6 } = getShopAndProduct(0);
  const o6Id = newId();
  const shippingFee6 = 4000;
  const itemTotal6 = v6.priceAmountMinor;
  await prisma.order.create({
    data: {
      id: o6Id,
      buyerId: buyer.id,
      shopId: shop6.id,
      status: OrderStatus.COMPLETED,
      shippingAmountMinor: shippingFee6,
      totalAmountMinor: itemTotal6 + shippingFee6,
      sellerConfirmedAt: fiveDaysAgo,
      sellerConfirmedBy: shop6.ownerId,
      shippedAt: threeDaysAgo,
      completedAt: oneDayAgo,
      shippingCarrierId: flash?.id,
      shippingCarrierNameAtShipment: flash?.name || 'Flash Express',
      trackingNumber: 'FLASH-VRU-102938TH',
      createdAt: fiveDaysAgo,
      updatedAt: oneDayAgo,
      ...defaultAddress,
    },
  });
  await prisma.orderItem.create({
    data: {
      id: newId(),
      orderId: o6Id,
      variantId: v6.id,
      productNameAtPurchase: prod6.name,
      variantNameAtPurchase: v6.name,
      priceAtPurchase: v6.priceAmountMinor,
      currency: 'THB',
      quantity: 1,
      createdAt: fiveDaysAgo,
    },
  });
  console.log(`✅ Order 6 (COMPLETED) created at ${shop6.name}`);

  // 7. CANCELLED (ยกเลิกแล้ว)
  const { shop: shop7, prod: prod7, variant: v7 } = getShopAndProduct(5, 'ผ้าทอ');
  const o7Id = newId();
  await prisma.order.create({
    data: {
      id: o7Id,
      buyerId: buyer.id,
      shopId: shop7.id,
      status: OrderStatus.CANCELLED,
      cancelledBy: OrderCancelledBy.BUYER,
      cancelReason: 'ผู้ซื้อขอยกเลิกคำสั่งซื้อเนื่องจากระบุที่อยู่จัดส่งผิด และต้องการเปลี่ยนจำนวน',
      cancelledAt: twoDaysAgo,
      shippingAmountMinor: 5000,
      totalAmountMinor: v7.priceAmountMinor + 5000,
      createdAt: threeDaysAgo,
      updatedAt: twoDaysAgo,
      ...defaultAddress,
    },
  });
  await prisma.orderItem.create({
    data: {
      id: newId(),
      orderId: o7Id,
      variantId: v7.id,
      productNameAtPurchase: prod7.name,
      variantNameAtPurchase: v7.name,
      priceAtPurchase: v7.priceAmountMinor,
      currency: 'THB',
      quantity: 1,
      createdAt: threeDaysAgo,
    },
  });
  console.log(`✅ Order 7 (CANCELLED) created at ${shop7.name}`);

  console.log('🎉 All 7 order statuses seeded successfully!');
}

main().catch(console.error);
