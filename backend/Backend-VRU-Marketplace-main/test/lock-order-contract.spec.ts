import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { checkoutAsShown } from './helpers/order.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { pauseNextTransactionAfterRawQuery, untilSettledOrWaiting } from './helpers/interleave.js';

/**
 * §114 — a scrutiny of lock order across the whole system and of the frontend contract.
 *
 * Six transactions took the `user` row `FOR UPDATE` where they only change ordinary columns.
 * `FOR UPDATE` also blocks the key lock a foreign-key check takes on that row, so a transaction
 * already holding an order and writing a column that points at the person (a payment confirmed
 * `sellerConfirmedBy` the owner, a notice to the buyer) waited on it while the first waited on the
 * order: a deadlock Postgres broke by failing one side with a 500.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';

async function post(client: Agent, path: string, body?: object) {
  const request = client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client));
  return body === undefined ? request : request.send(body);
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

/** A super admin, an approved shop with one approved product, and a buyer whose slip awaits the shop. */
async function orderAwaitingConfirmation(app: TestApp) {
  const superAdmin = app.client;
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const categoryId = ((await post(superAdmin, '/categories', { name: 'ขนมไทย' })).body as { id: string }).id;
  const seller = newClient(app);
  await registerVerified(app, seller, SELLER);
  const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
  await approveShop(app, shopId);
  const product = (await post(seller, '/products', {
    name: 'ขนมชั้นใบเตย',
    description: 'คำอธิบายสินค้าสำหรับทดสอบ',
    categoryId,
    variants: [{ name: 'กล่องเล็ก', priceAmountMinor: 10000, stock: 5 }],
  })).body as { id: string; variants: { id: string }[] };
  await approveProduct(superAdmin, product.id);

  const buyer = newClient(app);
  const buyerId = await registerVerified(app, buyer, BUYER);
  const spc = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  const addressId = ((await post(buyer, '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId: spc.id })).body as { id: string }).id;
  await post(buyer, '/cart/items', { variantId: product.variants[0]!.id, quantity: 1 });
  const orderId = ((await checkoutAsShown(buyer, addressId)).body as { id: string }[])[0]!.id;
  await post(seller, `/shops/me/orders/${orderId}/shipping-fee`, { shippingAmountMinor: 2000 });
  await buyer.post(`${API}/orders/${orderId}/payment-slips`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await aJpegBuffer(), 'slip.jpg');

  return { superAdmin, seller, buyer, buyerId, orderId };
}

async function openDispute(buyer: Agent, orderId: string): Promise<string> {
  const opened = await buyer
    .post(`${API}/orders/${orderId}/dispute`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .field('reason', 'โอนเงินไปแล้วแต่ร้านไม่ยอมยืนยันและไม่ตอบแชทเลย')
    .attach('files', await aJpegBuffer(), 'evidence.jpg');

  return (opened.body as { id: string }).id;
}

describe('§114 — a person’s row is locked for writing their own columns, not against every reference to them', () => {
  it('ruling for the buyer while the shop confirms the same payment: both answer, no 500', async () => {
    const app = getApp();
    const { superAdmin, seller, buyer, orderId } = await orderAwaitingConfirmation(app);
    const disputeId = await openDispute(buyer, orderId);
    let confirming: Promise<number> | undefined;
    pauseNextTransactionAfterRawQuery(app, 1, async () => {
      confirming = post(seller, `/shops/me/orders/${orderId}/confirm-payment`).then((r) => r.status);
      await untilSettledOrWaiting(app, confirming);
    });

    const ruled = await post(superAdmin, `/disputes/${disputeId}/ruling`, { verdict: 'BUYER_WINS', reason: 'ร้านไม่ยืนยันเงินเข้าทั้งที่ผู้ซื้อโอนแล้ว ให้ร้านคืนเงิน' });

    expect(ruled.status).toBe(200);
    expect(await confirming).toBe(200);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('REFUND_ORDERED');
  });

  it('lifting the buyer’s ban while their dispute is ruled for the shop: both answer, no 500', async () => {
    const app = getApp();
    const { superAdmin, buyer, buyerId, orderId } = await orderAwaitingConfirmation(app);
    const disputeId = await openDispute(buyer, orderId);
    expect((await post(superAdmin, `/admin/users/${buyerId}/ban`, { reason: 'ทดสอบการปลดแบนระหว่างตัดสินข้อพิพาท' })).status).toBe(204);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).frozenAt).not.toBeNull();
    let unbanning: Promise<number> | undefined;
    pauseNextTransactionAfterRawQuery(app, 1, async () => {
      unbanning = post(superAdmin, `/admin/users/${buyerId}/unban`).then((r) => r.status);
      await untilSettledOrWaiting(app, unbanning);
    });

    const ruled = await post(superAdmin, `/disputes/${disputeId}/ruling`, { verdict: 'SHOP_WINS', reason: 'ตรวจหลักฐานแล้ว ร้านยังอยู่ในเวลายืนยันเงินเข้า จึงให้ร้านเป็นฝ่ายถูก' });

    expect(ruled.status).toBe(200);
    expect(await unbanning).toBe(204);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).frozenAt).toBeNull();
  });
});

describe('§114 — the generated API docs describe the admin chat read and the cart’s refusals', () => {
  it('ChatMessageDto and ChatMessageVersionDto have their fields, and POST /cart/items documents 400 and 409', async () => {
    const app = getApp();

    const document = (await newClient(app).get('/api/v1/docs-json')).body as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };

    expect(Object.keys(document.components.schemas.ChatMessageDto!.properties ?? {})).toEqual(
      expect.arrayContaining(['id', 'roomId', 'senderId', 'content', 'createdAt', 'editedAt', 'unsentAt']),
    );
    expect(Object.keys(document.components.schemas.ChatMessageVersionDto!.properties ?? {}).sort()).toEqual(['content', 'id', 'writtenAt']);
    expect(Object.keys(document.paths['/api/v1/cart/items']!.post!.responses)).toEqual(expect.arrayContaining(['400', '409']));
  });
});
