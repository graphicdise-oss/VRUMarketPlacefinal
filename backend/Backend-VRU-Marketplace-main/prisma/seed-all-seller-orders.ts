import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, OrderStatus, OrderCancelledBy } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const newId = () => uuidv7();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  // 1. Find seller.demo and its shop
  const seller = await prisma.user.findUnique({
    where: { email: 'seller.demo@vru.ac.th' },
    include: { shops: true },
  });

  if (!seller || !seller.shops.length) {
    console.error('seller.demo@vru.ac.th or shop not found!');
    return;
  }

  const shop = seller.shops[0];
  if (!shop) {
    console.error('No shop found for seller.demo@vru.ac.th!');
    return;
  }
  console.log(`Target Shop: ${shop.name} (${shop.id})`);

  // 2. Find a buyer
  const buyer = await prisma.user.findUnique({
    where: { email: 'buyer.demo@vru.ac.th' },
  });

  if (!buyer) {
    console.error('Buyer buyer.demo@vru.ac.th not found!');
    return;
  }

  // 3. Find products belonging to this shop
  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    include: { variants: true },
  });

  console.log(`Found ${products.length} products for this shop.`);
  if (products.length === 0) {
    console.error('No products found for demo shop!');
    return;
  }

  const getProductAndVariant = (index: number) => {
    const prod = products[index] ?? products[0];
    if (!prod) throw new Error('No product available in demo shop');
    const variant = prod.variants[0];
    if (!variant) throw new Error(`No variant in product ${prod.name}`);
    return { prod, variant };
  };

  const p0 = getProductAndVariant(0);
  const p1 = getProductAndVariant(1);
  const p2 = getProductAndVariant(2);
  const p3 = getProductAndVariant(3);

  // 4. Find carriers
  const carriers = await prisma.shippingCarrier.findMany();
  const kerry = carriers.find(c => c.name.toLowerCase().includes('kerry')) ?? carriers[0];
  const flash = carriers.find(c => c.name.toLowerCase().includes('flash')) ?? carriers[0];

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  // Clear existing orders for this shop
  await prisma.orderItem.deleteMany({
    where: { order: { shopId: shop.id } },
  });
  await prisma.paymentSlip.deleteMany({
    where: { order: { shopId: shop.id } },
  });
  await prisma.order.deleteMany({
    where: { shopId: shop.id },
  });
  console.log('Cleared existing demo shop orders.');

  const defaultAddress = {
    recipientName: 'สมใจ รักเรียน',
    phone: '0891234567',
    houseNumber: '99 หมู่ 5 ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี 12120',
    subdistrictName: 'คลองหนึ่ง',
    districtName: 'คลองหลวง',
    provinceName: 'ปทุมธานี',
    postalCode: '12120',
    currency: 'THB',
  };

  interface OrderSpec {
    status: OrderStatus;
    shippingAmountMinor: number | null;
    totalAmountMinor: number | null;
    shippingQuoteWindowStartedAt?: Date;
    paymentWindowStartedAt?: Date;
    paymentConfirmationWindowStartedAt?: Date;
    sellerConfirmedAt?: Date;
    sellerConfirmedBy?: string;
    shippedAt?: Date;
    completedAt?: Date;
    cancelledAt?: Date;
    cancelledBy?: OrderCancelledBy;
    cancelReason?: string;
    shippingCarrierId?: string;
    shippingCarrierNameAtShipment?: string;
    trackingNumber?: string;
    product: (typeof p0)['prod'];
    variant: (typeof p0)['variant'];
    qty: number;
    hoursAgo: number;
  }

  const specs: OrderSpec[] = [
    {
      status: OrderStatus.AWAITING_SHIPPING_QUOTE,
      shippingAmountMinor: null,
      totalAmountMinor: null,
      shippingQuoteWindowStartedAt: new Date(now.getTime() - 2 * 3600 * 1000),
      product: p0.prod,
      variant: p0.variant,
      qty: 2,
      hoursAgo: 2,
    },
    {
      status: OrderStatus.AWAITING_PAYMENT,
      shippingAmountMinor: 4500,
      totalAmountMinor: (p1.variant.priceAmountMinor || 35000) * 1 + 4500,
      shippingQuoteWindowStartedAt: new Date(now.getTime() - 6 * 3600 * 1000),
      paymentWindowStartedAt: new Date(now.getTime() - 1 * 3600 * 1000),
      product: p1.prod,
      variant: p1.variant,
      qty: 1,
      hoursAgo: 6,
    },
    {
      status: OrderStatus.PAYMENT_SUBMITTED,
      shippingAmountMinor: 5000,
      totalAmountMinor: (p2.variant.priceAmountMinor || 28000) * 2 + 5000,
      shippingQuoteWindowStartedAt: new Date(now.getTime() - 20 * 3600 * 1000),
      paymentWindowStartedAt: new Date(now.getTime() - 10 * 3600 * 1000),
      paymentConfirmationWindowStartedAt: new Date(now.getTime() - 1 * 3600 * 1000),
      product: p2.prod,
      variant: p2.variant,
      qty: 2,
      hoursAgo: 20,
    },
    {
      status: OrderStatus.PAID,
      shippingAmountMinor: 4000,
      totalAmountMinor: (p3.variant.priceAmountMinor || 8500) * 3 + 4000,
      sellerConfirmedAt: new Date(now.getTime() - 6 * 3600 * 1000),
      sellerConfirmedBy: seller.id,
      product: p3.prod,
      variant: p3.variant,
      qty: 3,
      hoursAgo: 24,
    },
    {
      status: OrderStatus.SHIPPED,
      shippingAmountMinor: 6000,
      totalAmountMinor: (p0.variant.priceAmountMinor || 35000) * 1 + 6000,
      sellerConfirmedAt: new Date(now.getTime() - 2 * dayMs),
      sellerConfirmedBy: seller.id,
      shippedAt: new Date(now.getTime() - 1 * dayMs),
      shippingCarrierId: kerry?.id,
      shippingCarrierNameAtShipment: kerry?.name || 'Kerry Express',
      trackingNumber: 'KERRY-VRU-665544TH',
      product: p0.prod,
      variant: p0.variant,
      qty: 1,
      hoursAgo: 48,
    },
    {
      status: OrderStatus.COMPLETED,
      shippingAmountMinor: 4000,
      totalAmountMinor: (p1.variant.priceAmountMinor || 22000) * 1 + 4000,
      sellerConfirmedAt: new Date(now.getTime() - 5 * dayMs),
      sellerConfirmedBy: seller.id,
      shippedAt: new Date(now.getTime() - 4 * dayMs),
      completedAt: new Date(now.getTime() - 1 * dayMs),
      shippingCarrierId: flash?.id,
      shippingCarrierNameAtShipment: flash?.name || 'Flash Express',
      trackingNumber: 'FLASH-VRU-778899TH',
      product: p1.prod,
      variant: p1.variant,
      qty: 1,
      hoursAgo: 120,
    },
    {
      status: OrderStatus.CANCELLED,
      shippingAmountMinor: null,
      totalAmountMinor: null,
      cancelledAt: new Date(now.getTime() - 3 * dayMs),
      cancelledBy: OrderCancelledBy.BUYER,
      cancelReason: 'ลูกค้าขอยกเลิกเนื่องจากเปลี่ยนใจเรื่องขนาดสินค้า',
      product: p2.prod,
      variant: p2.variant,
      qty: 1,
      hoursAgo: 72,
    },
  ];

  for (const s of specs) {
    const oId = newId();
    const createdAt = new Date(now.getTime() - s.hoursAgo * 3600 * 1000);
    const v = s.variant;
    const price = v.priceAmountMinor || 25000;

    await prisma.order.create({
      data: {
        id: oId,
        buyerId: buyer.id,
        shopId: shop.id,
        status: s.status,
        shippingAmountMinor: s.shippingAmountMinor,
        totalAmountMinor: s.totalAmountMinor,
        shippingQuoteWindowStartedAt: s.shippingQuoteWindowStartedAt,
        paymentWindowStartedAt: s.paymentWindowStartedAt,
        paymentConfirmationWindowStartedAt: s.paymentConfirmationWindowStartedAt,
        sellerConfirmedAt: s.sellerConfirmedAt,
        sellerConfirmedBy: s.sellerConfirmedBy,
        shippedAt: s.shippedAt,
        completedAt: s.completedAt,
        cancelledAt: s.cancelledAt,
        cancelledBy: s.cancelledBy,
        cancelReason: s.cancelReason,
        shippingCarrierId: s.shippingCarrierId,
        shippingCarrierNameAtShipment: s.shippingCarrierNameAtShipment,
        trackingNumber: s.trackingNumber,
        createdAt,
        updatedAt: createdAt,
        ...defaultAddress,
      },
    });

    await prisma.orderItem.create({
      data: {
        id: newId(),
        orderId: oId,
        variantId: v.id,
        productNameAtPurchase: s.product.name,
        variantNameAtPurchase: v.name,
        priceAtPurchase: price,
        quantity: s.qty,
        currency: 'THB',
        createdAt,
      },
    });

    console.log(`✅ Created Order ${oId.slice(0, 8)} [${s.status}] for ${s.product.name}`);
  }

  console.log('🎉 Successfully seeded all 7 orders for seller.demo shop!');
}

main().catch((error: unknown) => {
  console.error('Seed all seller orders failed:', error);
  process.exitCode = 1;
});
