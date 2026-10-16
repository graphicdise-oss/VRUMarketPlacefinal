import sharp from 'sharp';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import type { ErrorBody } from '../src/common/errors/error-payload.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * §105 — found scrutinizing the user-side chat and the shop's payment channels, and decided by the
 * project owner: a frozen order hides the shop's bank details (its slip upload is refused already),
 * a QR photo goes when the number or type it was taken of changes, every change to where a shop
 * gets paid tells its owner in the app, and an admin account opens no new buyer's chat room (N29).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const ADMIN = 'admin@example.test';

type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };
interface ChannelBody {
  id: string;
  promptPayId: string | null;
  bankAccountNumber: string | null;
  hasQrImage: boolean;
}
interface NotificationBody {
  type: string;
  message: string;
  targetType: string | null;
  targetId: string | null;
}

async function post(client: Agent, path: string, body: object = {}) {
  return client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

async function patch(client: Agent, path: string, body: object) {
  return client.patch(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

async function arrangeShop(app: TestApp) {
  const superAdmin = app.client;
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const categoryId = ((await post(superAdmin, '/categories', { name: 'เสื้อผ้า' })).body as { id: string }).id;
  const seller = newClient(app);
  await registerVerified(app, seller, SELLER);
  const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านทดสอบ' })).body as { id: string }).id;
  await approveShop(app, shopId);

  return { superAdmin, communityId, categoryId, seller, shopId };
}

type Arranged = Awaited<ReturnType<typeof arrangeShop>>;

/** An order the shop has quoted, so it sits in AWAITING_PAYMENT — L1's window for bank details. */
async function orderAwaitingPayment(app: TestApp, arranged: Arranged): Promise<{ buyer: Agent; orderId: string }> {
  const created = await post(arranged.seller, '/products', {
    name: 'ตะกร้าหวายสาน',
    description: 'คำอธิบายสินค้าสำหรับทดสอบ',
    categoryId: arranged.categoryId,
    variants: [{ name: 'แบบเดียว', priceAmountMinor: 5000, stock: 3 }],
  });
  const productId = (created.body as { id: string }).id;
  await approveProduct(arranged.superAdmin, productId);
  const variantId = ((await arranged.seller.get(`${API}/products/${productId}`)).body as { variants: { id: string }[] }).variants[0]!.id;

  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const subdistrict = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  const addressId = ((await post(buyer, '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId: subdistrict.id })).body as { id: string }).id;
  await post(buyer, '/cart/items', { variantId, quantity: 1 });
  const orderId = ((await checkoutAsShown(buyer, addressId)).body as { id: string }[])[0]!.id;
  await post(arranged.seller, `/shops/me/orders/${orderId}/shipping-fee`, { shippingAmountMinor: 2000 });

  return { buyer, orderId };
}

async function aQrPhoto(blue: number): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: blue } } })
    .jpeg()
    .toBuffer();
}

async function uploadQr(seller: Agent, channelId: string): Promise<void> {
  const uploaded = await seller
    .post(`${API}/shops/me/payment-channels/${channelId}/qr-image`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .attach('file', await aQrPhoto(200), 'qr.jpg');
  expect(uploaded.status).toBe(200);
}

async function channelChangeNotices(seller: Agent): Promise<NotificationBody[]> {
  const listed = await seller.get(`${API}/notifications`);
  return (listed.body as { items: NotificationBody[] }).items.filter((n) => n.type === 'PAYMENT_CHANNEL_CHANGED');
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: AckResponse<T>) => resolve(response));
  });
}

async function connectedSocket(app: TestApp, client: Agent): Promise<ClientSocket> {
  const socket = chatSocket(app, client);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error: Error) => reject(error));
    socket.connect();
  });

  return socket;
}

describe('a frozen order hides the shop’s bank details (§105)', () => {
  it('answers 404 for the channels and the QR while frozen, and shows them again once released', async () => {
    const app = getApp();
    const arranged = await arrangeShop(app);
    const channelId = ((await post(arranged.seller, '/shops/me/payment-channels', { type: 'PROMPTPAY', promptPayId: '0899999999' })).body as ChannelBody).id;
    await uploadQr(arranged.seller, channelId);
    const { buyer, orderId } = await orderAwaitingPayment(app, arranged);
    expect((await buyer.get(`${API}/orders/${orderId}/payment-channels`)).status).toBe(200);

    // The real freeze path (invariant 7): suspending the shop freezes its open orders. The slip
    // upload is already refused while frozen — showing where to transfer would invite a payment
    // the buyer then has no way to attach proof of.
    await post(arranged.superAdmin, `/shops/${arranged.shopId}/suspend`, { reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });

    expect((await buyer.get(`${API}/orders/${orderId}/payment-channels`)).status).toBe(404);
    expect((await buyer.get(`${API}/orders/${orderId}/payment-channels/${channelId}/qr-image`)).status).toBe(404);

    await post(arranged.superAdmin, `/shops/${arranged.shopId}/unsuspend`);

    const released = await buyer.get(`${API}/orders/${orderId}/payment-channels`);
    expect(released.status).toBe(200);
    expect((released.body as ChannelBody[])[0]?.promptPayId).toBe('0899999999');
    expect((await buyer.get(`${API}/orders/${orderId}/payment-channels/${channelId}/qr-image`)).status).toBe(200);
  });
});

describe('a QR photo goes when the number or type it shows changes (§105)', () => {
  it('drops the QR when the PromptPay number changes, so a new number never sits beside the old code', async () => {
    const app = getApp();
    const { seller } = await arrangeShop(app);
    const channelId = ((await post(seller, '/shops/me/payment-channels', { type: 'PROMPTPAY', promptPayId: '0811111111' })).body as ChannelBody).id;
    await uploadQr(seller, channelId);

    const renumbered = await patch(seller, `/shops/me/payment-channels/${channelId}`, { type: 'PROMPTPAY', promptPayId: '0822222222' });

    expect(renumbered.status).toBe(200);
    expect((renumbered.body as ChannelBody).hasQrImage).toBe(false);
    expect((await seller.get(`${API}/shops/me/payment-channels/${channelId}/qr-image`)).status).toBe(404);
  });

  it('drops the QR when the bank account number changes', async () => {
    const app = getApp();
    const { seller } = await arrangeShop(app);
    const bank = { type: 'BANK_TRANSFER', bankName: 'กสิกรไทย', bankAccountNumber: '123-4-56789-0', bankAccountName: 'ร้านทดสอบ' };
    const channelId = ((await post(seller, '/shops/me/payment-channels', bank)).body as ChannelBody).id;
    await uploadQr(seller, channelId);

    const renumbered = await patch(seller, `/shops/me/payment-channels/${channelId}`, { ...bank, bankAccountNumber: '987-6-54321-0' });

    expect(renumbered.status).toBe(200);
    expect((renumbered.body as ChannelBody).hasQrImage).toBe(false);
  });

  it('drops the QR when the type changes', async () => {
    const app = getApp();
    const { seller } = await arrangeShop(app);
    const channelId = ((await post(seller, '/shops/me/payment-channels', { type: 'PROMPTPAY', promptPayId: '0811111111' })).body as ChannelBody).id;
    await uploadQr(seller, channelId);

    const retyped = await patch(seller, `/shops/me/payment-channels/${channelId}`, {
      type: 'BANK_TRANSFER',
      bankName: 'กสิกรไทย',
      bankAccountNumber: '123-4-56789-0',
      bankAccountName: 'ร้านทดสอบ',
    });

    expect((retyped.body as ChannelBody).hasQrImage).toBe(false);
  });

  it('keeps the QR when the number and type stay — renaming the bank or the account holder, or saving it unchanged', async () => {
    const app = getApp();
    const { seller } = await arrangeShop(app);
    const bank = { type: 'BANK_TRANSFER', bankName: 'กสิกรไทย', bankAccountNumber: '123-4-56789-0', bankAccountName: 'ร้านทดสอบ' };
    const channelId = ((await post(seller, '/shops/me/payment-channels', bank)).body as ChannelBody).id;
    await uploadQr(seller, channelId);

    const renamed = await patch(seller, `/shops/me/payment-channels/${channelId}`, { ...bank, bankName: 'ธนาคารกสิกรไทย', bankAccountName: 'ร้านทดสอบ จำกัด' });
    const resaved = await patch(seller, `/shops/me/payment-channels/${channelId}`, { ...bank, bankName: 'ธนาคารกสิกรไทย', bankAccountName: 'ร้านทดสอบ จำกัด' });

    expect((renamed.body as ChannelBody).hasQrImage).toBe(true);
    expect((resaved.body as ChannelBody).hasQrImage).toBe(true);
    expect((await seller.get(`${API}/shops/me/payment-channels/${channelId}/qr-image`)).status).toBe(200);
  });
});

describe('every change to where a shop gets paid tells its owner, in the app (§105)', () => {
  it('notifies on add, edit, QR upload and removal — never with the number itself, and never by email', async () => {
    const app = getApp();
    const { seller, shopId } = await arrangeShop(app);
    app.email.clear();

    const channelId = ((await post(seller, '/shops/me/payment-channels', { type: 'PROMPTPAY', promptPayId: '0811111111' })).body as ChannelBody).id;
    expect(await channelChangeNotices(seller)).toHaveLength(1);
    await patch(seller, `/shops/me/payment-channels/${channelId}`, { type: 'PROMPTPAY', promptPayId: '0822222222' });
    expect(await channelChangeNotices(seller)).toHaveLength(2);
    await uploadQr(seller, channelId);
    expect(await channelChangeNotices(seller)).toHaveLength(3);
    const removed = await seller.delete(`${API}/shops/me/payment-channels/${channelId}`).set(CSRF_HEADER, await csrfToken(seller));
    expect(removed.status).toBe(204);

    const notices = await channelChangeNotices(seller);
    expect(notices).toHaveLength(4);
    for (const notice of notices) {
      // The point is a hijacked account's swap being noticed by the real owner — the notice says
      // what happened and what to do, and carries no account or PromptPay number to leak.
      expect(notice).toMatchObject({ targetType: 'SHOP', targetId: shopId });
      expect(notice.message).not.toMatch(/0811111111|0822222222/);
    }
    expect(app.email.sent).toEqual([]);
  });

  it('does not notify an edit that changed nothing', async () => {
    const app = getApp();
    const { seller } = await arrangeShop(app);
    const body = { type: 'PROMPTPAY', promptPayId: '0811111111' };
    const channelId = ((await post(seller, '/shops/me/payment-channels', body)).body as ChannelBody).id;

    const resaved = await patch(seller, `/shops/me/payment-channels/${channelId}`, body);

    expect(resaved.status).toBe(200);
    expect(await channelChangeNotices(seller)).toHaveLength(1);
  });
});

describe('an admin account opens no new buyer’s chat room (§105 · N29)', () => {
  it('refuses a community admin, and a super admin, opening a room with a shop', async () => {
    const app = getApp();
    const { superAdmin, communityId, seller, shopId } = await arrangeShop(app);
    const admin = newClient(app);
    const adminId = await registerVerified(app, admin, ADMIN);
    expect((await post(superAdmin, `/communities/${communityId}/admins`, { userId: adminId })).status).toBe(201);

    for (const client of [admin, superAdmin]) {
      const socket = await connectedSocket(app, client);
      const opened = await emitAck(socket, 'openRoomWithShop', { shopId });
      socket.disconnect();

      expect(opened).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    const sellerSocket = await connectedSocket(app, seller);
    const sellerRooms = await emitAck<{ items: unknown[] }>(sellerSocket, 'listRooms', {});
    sellerSocket.disconnect();
    expect(sellerRooms).toMatchObject({ ok: true, data: { items: [] } });
  });

  it('lets a room opened before the appointment carry on', async () => {
    const app = getApp();
    const { superAdmin, communityId, shopId } = await arrangeShop(app);
    const buyerThenAdmin = newClient(app);
    const userId = await registerVerified(app, buyerThenAdmin, ADMIN);
    const socket = await connectedSocket(app, buyerThenAdmin);
    const opened = await emitAck<{ id: string }>(socket, 'openRoomWithShop', { shopId });
    if (!opened.ok) {
      throw new Error(`openRoomWithShop failed before the appointment: ${opened.error.code}`);
    }
    const roomId = opened.data.id;

    expect((await post(superAdmin, `/communities/${communityId}/admins`, { userId })).status).toBe(201);

    // The conversation with this shop predates the appointment and is theirs; only a new one,
    // started from an admin account, is refused.
    const rejoined = await emitAck<{ id: string }>(socket, 'joinRoom', { roomId });
    const reopened = await emitAck<{ id: string }>(socket, 'openRoomWithShop', { shopId });
    const sent = await emitAck(socket, 'sendMessage', { roomId, content: 'ขอบคุณสำหรับของที่ส่งมาครับ' });
    socket.disconnect();

    expect(rejoined.ok).toBe(true);
    expect(reopened).toMatchObject({ ok: true, data: { id: roomId } });
    expect(sent.ok).toBe(true);
  });
});
