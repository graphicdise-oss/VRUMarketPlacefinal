import sharp from 'sharp';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #68: the one break-glass door into a chat room — a community admin (or super admin) may read a
 * room's full history and attachments only while an order between its two parties currently has
 * an open dispute (I5, extended to F4/K14's WebSocket-only conversation). Every check here is
 * `ChatRoomIdScopeResolver` alone, calling #64's own `isOrderUnderOpenDisputeBreakGlass` — see
 * that resolver's comment for why nothing in this feature re-decides "open" itself.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const ADMIN_A = 'admin-a@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
}
interface DisputeBody {
  id: string;
  orderId: string;
  closedAt: string | null;
}
interface RoomBody {
  id: string;
  buyerId: string;
  shopOwnerUserId: string;
}
interface MessageBody {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  fileId: string | null;
}
interface ErrorBody {
  code: string;
  message: string;
}
type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function createCommunity(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin
    .post(`${API}/communities`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name, description: 'รายละเอียดสำหรับทดสอบ' });

  return (response.body as { id: string }).id;
}

async function assignAdmin(superAdmin: Agent, communityId: string, userId: string): Promise<void> {
  await superAdmin
    .post(`${API}/communities/${communityId}/admins`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ userId });
}

async function createCategory(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin
    .post(`${API}/categories`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name });

  return (response.body as { id: string }).id;
}

async function sellerWithShop(app: TestApp, email: string, communityId: string): Promise<{ seller: Agent; shopId: string; sellerId: string }> {
  const seller = newClient(app);
  const sellerId = await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return { seller, shopId, sellerId };
}

async function approvedProduct(superAdmin: Agent, seller: Agent, categoryId: string, name: string, priceAmountMinor: number, stock: number): Promise<ProductBody> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ name, description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId, variants: [{ name: 'แบบเดียว', priceAmountMinor, stock }] });
  const productId = (created.body as { id: string }).id;
  await approveProduct(superAdmin, productId);

  const fetched = await seller.get(`${API}/products/${productId}`);
  return fetched.body as ProductBody;
}

async function aRealSubdistrictPostalCodeId(app: TestApp): Promise<string> {
  const row = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  return row.id;
}

async function createAddress(app: TestApp, client: Agent): Promise<string> {
  const subdistrictPostalCodeId = await aRealSubdistrictPostalCodeId(app);
  const response = await client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId });

  return (response.body as { id: string }).id;
}

async function placeOrder(app: TestApp, buyer: Agent, variantId: string): Promise<OrderBody> {
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity: 1 });
  const response = await checkoutAsShown(buyer, addressId);

  return (response.body as OrderBody[])[0]!;
}

async function setShippingFee(seller: Agent, orderId: string, shippingAmountMinor: number) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingAmountMinor });
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

async function uploadPaymentSlip(buyer: Agent, orderId: string): Promise<void> {
  await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
}

async function uploadRefundSlip(seller: Agent, orderId: string): Promise<void> {
  await seller
    .post(`${API}/shops/me/orders/${orderId}/refund-slips`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .attach('file', await aJpegBuffer(), 'refund-slip.jpg');
}

async function openDispute(client: Agent, orderId: string, reason: string): Promise<DisputeBody> {
  const response = await client
    .post(`${API}/orders/${orderId}/dispute`)
    .set(CSRF_HEADER, await csrfToken(client))
    .field('reason', reason)
    .attach('files', await aJpegBuffer(), 'evidence.jpg');

  return response.body as DisputeBody;
}

async function ruleDispute(client: Agent, disputeId: string, verdict: string, reason: string) {
  return client
    .post(`${API}/disputes/${disputeId}/ruling`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ verdict, reason });
}

const openSockets: ClientSocket[] = [];

afterEach(() => {
  for (const socket of openSockets) {
    socket.disconnect();
  }
  openSockets.length = 0;
});

function connect(socket: ClientSocket): Promise<void> {
  openSockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error: Error) => reject(error));
    socket.connect();
  });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: AckResponse<T>) => resolve(response));
  });
}

async function openChatRoomAndSend(app: TestApp, buyer: Agent, shopId: string, content: string): Promise<{ roomId: string }> {
  const socket = chatSocket(app, buyer);
  await connect(socket);
  const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
  if (!opened.ok) throw new Error('failed to open room');
  const roomId = opened.data.id;

  const sent = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content });
  if (!sent.ok) throw new Error('failed to send message');

  return { roomId };
}

async function uploadChatAttachment(buyer: Agent, roomId: string): Promise<string> {
  const response = await buyer
    .post(`${API}/chat-rooms/${roomId}/attachments`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'attachment.jpg');

  return (response.body as { fileId: string }).fileId;
}

const RULING_REASON = 'จากหลักฐานทั้งสองฝ่าย สินค้าที่ส่งไม่ตรงตามที่ตกลงไว้จริง ผู้ซื้อจึงเป็นฝ่ายถูก';
const PRE_DISPUTE_MESSAGE = 'สอบถามก่อนมีปัญหา สินค้าจะส่งวันไหนครับ';

/**
 * A community, its admin, a shop, a buyer who already opened a chat room and sent a message
 * *before* anything went wrong, then a real order and an open dispute on it — the same shape
 * `dispute-ruling.spec.ts` builds, plus the chat room #68 is what reads.
 */
async function openDisputeWithChatScenario(app: TestApp): Promise<{
  superAdmin: Agent;
  adminA: Agent;
  seller: Agent;
  sellerId: string;
  shopId: string;
  buyer: Agent;
  order: OrderBody;
  dispute: DisputeBody;
  roomId: string;
}> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');

  const adminA = newClient(app);
  const adminAId = await registerVerified(app, adminA, ADMIN_A);
  await assignAdmin(superAdmin, communityId, adminAId);

  const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบข้อพิพาท', 10000, 5);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);

  const { roomId } = await openChatRoomAndSend(app, buyer, shopId, PRE_DISPUTE_MESSAGE);

  const order = await placeOrder(app, buyer, product.variants[0]!.id);
  await setShippingFee(seller, order.id, 2000);
  await uploadPaymentSlip(buyer, order.id);

  const dispute = await openDispute(buyer, order.id, 'สินค้าที่ได้รับไม่ตรงกับที่สั่งเลยครับ');

  return { superAdmin, adminA, seller, sellerId, shopId, buyer, order, dispute, roomId };
}

function readMessages(client: Agent, roomId: string) {
  return client.get(`${API}/chat-rooms/${roomId}/admin/messages`);
}

function readAttachment(client: Agent, roomId: string, fileId: string) {
  return client.get(`${API}/chat-rooms/${roomId}/admin/attachments/${fileId}`);
}

describe('#68 — admin break-glass read of a chat room, only while a dispute is open', () => {
  it('reads the whole room — including a message sent before the dispute ever existed', async () => {
    const app = getApp();
    const { adminA, roomId } = await openDisputeWithChatScenario(app);

    const response = await readMessages(adminA, roomId);
    expect(response.status).toBe(200);
    const body = response.body as { items: MessageBody[] };
    expect(body.items.map((m) => m.content)).toContain(PRE_DISPUTE_MESSAGE);
  });

  it('refuses when no order between the two parties has ever had a dispute', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนไม่มีข้อพิพาท');
    const adminA = newClient(app);
    const adminAId = await registerVerified(app, adminA, ADMIN_A);
    await assignAdmin(superAdmin, communityId, adminAId);
    const { shopId } = await sellerWithShop(app, SELLER, communityId);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const { roomId } = await openChatRoomAndSend(app, buyer, shopId, 'คุยกันเฉยๆ ไม่มีปัญหาอะไร');

    const response = await readMessages(adminA, roomId);
    expect(response.status).toBe(403);
  });

  it('🚨 closes the instant the dispute is ruled (SHOP_WINS closes at ruling time)', async () => {
    const app = getApp();
    const { adminA, dispute, roomId } = await openDisputeWithChatScenario(app);

    const whileOpen = await readMessages(adminA, roomId);
    expect(whileOpen.status).toBe(200);

    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    const afterClosed = await readMessages(adminA, roomId);
    expect(afterClosed.status).toBe(403);
  });

  it('🚨 closes via H7’s 7-day cron too, not only a ruling — same live check, no special case', async () => {
    const app = getApp();
    const { superAdmin, adminA, seller, order, dispute, roomId } = await openDisputeWithChatScenario(app);

    // BUYER_WINS deliberately leaves the dispute open (#65) — the refund loop is what eventually
    // closes it, either the buyer confirming (H6) or, here, going silent for 7 days (H7).
    await ruleDispute(adminA, dispute.id, 'BUYER_WINS', RULING_REASON);
    const stillOpen = await readMessages(adminA, roomId);
    expect(stillOpen.status).toBe(200);

    await login(seller, SELLER);
    await uploadRefundSlip(seller, order.id);

    app.clock.advanceByDays(7);
    await app.sweep.run();

    await login(superAdmin, SUPER);
    await login(adminA, ADMIN_A);
    const afterCronClosed = await readMessages(adminA, roomId);
    expect(afterCronClosed.status).toBe(403);
  });

  it('an admin can read, but has no way to send — the socket rejects a non-party exactly like any other stranger', async () => {
    const app = getApp();
    const { adminA, roomId } = await openDisputeWithChatScenario(app);

    const whileOpen = await readMessages(adminA, roomId);
    expect(whileOpen.status).toBe(200);

    const adminSocket = chatSocket(app, adminA);
    await connect(adminSocket);
    const joined = await emitAck<RoomBody>(adminSocket, 'joinRoom', { roomId });
    expect(joined.ok).toBe(false);
    if (!joined.ok) {
      expect(joined.error.code).toBe('NOT_FOUND');
    }
  });

  it('⚠️ logs DISPUTE_CHAT_VIEWED on every read, not just the first — and never the message content', async () => {
    const app = getApp();
    const { adminA, roomId } = await openDisputeWithChatScenario(app);

    await readMessages(adminA, roomId);
    await readMessages(adminA, roomId);

    const entries = await app.prisma.auditLog.findMany({ where: { action: 'DISPUTE_CHAT_VIEWED', targetId: roomId } });
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.targetType).toBe('CHAT_ROOM');
      expect(entry.reason).toBeNull();
    }
  });

  it('⚠️ a community admin outside the shop’s community cannot read this room, even with the dispute open', async () => {
    const app = getApp();
    const { superAdmin, roomId } = await openDisputeWithChatScenario(app);
    const communityB = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const adminB = newClient(app);
    const adminBId = await registerVerified(app, adminB, 'admin-b@example.test');
    await assignAdmin(superAdmin, communityB, adminBId);

    const response = await readMessages(adminB, roomId);
    expect(response.status).toBe(403);
  });

  it('super admin reads without any CommunityAdmin row', async () => {
    const app = getApp();
    const { superAdmin, roomId } = await openDisputeWithChatScenario(app);

    const response = await readMessages(superAdmin, roomId);
    expect(response.status).toBe(200);
  });

  it('an admin can open a chat attachment under the same open-dispute condition, and it is audited', async () => {
    const app = getApp();
    const { adminA, buyer, roomId, dispute } = await openDisputeWithChatScenario(app);
    await login(buyer, BUYER);
    const fileId = await uploadChatAttachment(buyer, roomId);
    // Attach the file to a real message so it is genuinely part of the room's history.
    const socket = chatSocket(app, buyer);
    await connect(socket);
    const sent = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, fileId });
    expect(sent.ok).toBe(true);

    const whileOpen = await readAttachment(adminA, roomId, fileId);
    expect(whileOpen.status).toBe(200);
    expect(whileOpen.headers['content-type']).toContain('image/jpeg');

    const entry = await app.prisma.auditLog.findFirst({ where: { action: 'DISPUTE_CHAT_VIEWED', targetId: roomId } });
    expect(entry).not.toBeNull();

    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);
    const afterClosed = await readAttachment(adminA, roomId, fileId);
    expect(afterClosed.status).toBe(403);
  });
});

describe('code review of topic 11 (§83)', () => {
  it('🚨 super admin is refused too once the dispute closes — invariant 8 binds every admin, not only community admins', async () => {
    const app = getApp();
    const { superAdmin, adminA, dispute, roomId } = await openDisputeWithChatScenario(app);
    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    const messages = await readMessages(superAdmin, roomId);
    expect(messages.status).toBe(403);
    expect(await app.prisma.auditLog.count({ where: { action: 'DISPUTE_CHAT_VIEWED', actorUserId: (await app.prisma.user.findUniqueOrThrow({ where: { email: SUPER } })).id } })).toBe(0);
  });

  it('🚨 super admin is refused on a room that never had a dispute', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนไม่มีข้อพิพาท');
    const { shopId } = await sellerWithShop(app, SELLER, communityId);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const { roomId } = await openChatRoomAndSend(app, buyer, shopId, 'คุยกันเฉยๆ ไม่มีปัญหาอะไร');
    const fileId = await uploadChatAttachment(buyer, roomId);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    await emitAck<MessageBody>(socket, 'sendMessage', { roomId, fileId });

    expect((await readMessages(superAdmin, roomId)).status).toBe(403);
    expect((await readAttachment(superAdmin, roomId, fileId)).status).toBe(403);
  });

  it('the DISPUTE_CHAT_VIEWED entry records the community of the open dispute’s shop (§75)', async () => {
    const app = getApp();
    const { adminA, superAdmin, shopId, roomId } = await openDisputeWithChatScenario(app);
    const shop = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });

    await readMessages(adminA, roomId);
    await readMessages(superAdmin, roomId);

    const entries = await app.prisma.auditLog.findMany({ where: { action: 'DISPUTE_CHAT_VIEWED' } });
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.communityId === shop.communityId)).toBe(true);
  });

  it('an admin’s attachment read is private and never cached, like the parties’ own (§82)', async () => {
    const app = getApp();
    const { adminA, buyer, roomId } = await openDisputeWithChatScenario(app);
    const fileId = await uploadChatAttachment(buyer, roomId);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    await emitAck<MessageBody>(socket, 'sendMessage', { roomId, fileId });

    const read = await readAttachment(adminA, roomId, fileId);

    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
  });

  it('two orders with the same shop are still one room, and a message may reference either (#66)', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, buyer, order, roomId } = await openDisputeWithChatScenario(app);
    const categoryId = await createCategory(superAdmin, 'ของใช้');
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของชิ้นที่สอง', 5000, 3);
    const secondOrder = await placeOrder(app, buyer, product.variants[0]!.id);
    expect(secondOrder.id).not.toBe(order.id);

    const socket = chatSocket(app, buyer);
    await connect(socket);
    const reopened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    expect(reopened.ok && reopened.data.id).toBe(roomId);

    const aboutFirst = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'เรื่องออเดอร์แรก', orderId: order.id });
    const aboutSecond = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'เรื่องออเดอร์ที่สอง', orderId: secondOrder.id });
    expect(aboutFirst.ok && aboutSecond.ok).toBe(true);
    expect(await app.prisma.chatRoom.count()).toBe(1);
  });

  it('🚨 no path turns a payment slip into a chat attachment, or a chat picture into a slip (E1/K17)', async () => {
    const app = getApp();
    const { buyer, order, roomId } = await openDisputeWithChatScenario(app);
    const slip = await app.prisma.paymentSlip.findFirstOrThrow({ where: { orderId: order.id } });
    const socket = chatSocket(app, buyer);
    await connect(socket);

    // The slip's file id is never in any response — read here as if it had leaked, which is the
    // exact "hard-to-guess id" defence #66 says must never be the only wall.
    const smuggled = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, fileId: slip.fileId });
    expect(smuggled.ok).toBe(false);
    expect((await buyer.get(`${API}/chat-rooms/${roomId}/attachments/${slip.fileId}`)).status).toBe(404);

    const chatFile = await uploadChatAttachment(buyer, roomId);
    await emitAck<MessageBody>(socket, 'sendMessage', { roomId, fileId: chatFile });
    const slipsBefore = await app.prisma.paymentSlip.count();
    const asSlip = await buyer
      .post(`${API}/orders/${order.id}/payment-slips`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .send({ fileId: chatFile });
    expect(asSlip.status).toBe(400);
    expect(await app.prisma.paymentSlip.count()).toBe(slipsBefore);
  });
});

describe('§89 — edited and unsent messages under break-glass: nothing is hidden from the admin', () => {
  interface AdminMessageBody extends MessageBody {
    editedAt: string | null;
    unsentAt: string | null;
  }
  interface VersionBody {
    content: string;
    writtenAt: string;
  }

  it('the admin reads an unsent message’s original text and picture, and every version of an edited one — each read audited', async () => {
    const app = getApp();
    const { adminA, buyer, roomId } = await openDisputeWithChatScenario(app);
    await login(buyer, BUYER);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    const edited = await emitAck<AdminMessageBody>(socket, 'sendMessage', { roomId, content: 'ของสภาพดี ไม่มีตำหนิ' });
    if (!edited.ok) throw new Error('send failed');
    await emitAck(socket, 'editMessage', { roomId, messageId: edited.data.id, content: 'ของมีตำหนินิดหน่อย' });
    const fileId = await uploadChatAttachment(buyer, roomId);
    const unsent = await emitAck<AdminMessageBody>(socket, 'sendMessage', { roomId, content: 'ยอมรับว่าผมทำพังเองครับ', fileId });
    if (!unsent.ok) throw new Error('send failed');
    await emitAck(socket, 'unsendMessage', { roomId, messageId: unsent.data.id });
    const auditBefore = await app.prisma.auditLog.count({ where: { action: 'DISPUTE_CHAT_VIEWED', targetId: roomId } });

    const list = await readMessages(adminA, roomId);
    const items = (list.body as { items: AdminMessageBody[] }).items;
    const asUnsent = items.find((m) => m.id === unsent.data.id);
    const asEdited = items.find((m) => m.id === edited.data.id);
    expect(asUnsent).toMatchObject({ content: 'ยอมรับว่าผมทำพังเองครับ', fileId, unsentAt: expect.any(String) as unknown });
    expect(asEdited).toMatchObject({ content: 'ของมีตำหนินิดหน่อย', editedAt: expect.any(String) as unknown });
    expect((await readAttachment(adminA, roomId, fileId)).status).toBe(200);

    const editedVersions = await adminA.get(`${API}/chat-rooms/${roomId}/admin/messages/${edited.data.id}/versions`);
    expect(editedVersions.status).toBe(200);
    expect((editedVersions.body as { items: VersionBody[] }).items.map((v) => v.content)).toEqual(['ของมีตำหนินิดหน่อย', 'ของสภาพดี ไม่มีตำหนิ']);
    const unsentVersions = await adminA.get(`${API}/chat-rooms/${roomId}/admin/messages/${unsent.data.id}/versions`);
    expect((unsentVersions.body as { items: VersionBody[] }).items.map((v) => v.content)).toEqual(['ยอมรับว่าผมทำพังเองครับ']);

    const auditAfter = await app.prisma.auditLog.count({ where: { action: 'DISPUTE_CHAT_VIEWED', targetId: roomId } });
    expect(auditAfter - auditBefore).toBe(4); // list · attachment · two version reads
  });

  it('the versions route closes with the dispute, like every other break-glass read', async () => {
    const app = getApp();
    const { adminA, buyer, roomId, dispute } = await openDisputeWithChatScenario(app);
    await login(buyer, BUYER);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    const sent = await emitAck<AdminMessageBody>(socket, 'sendMessage', { roomId, content: 'ข้อความสำหรับทดสอบ' });
    if (!sent.ok) throw new Error('send failed');
    await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON);

    const afterClosed = await adminA.get(`${API}/chat-rooms/${roomId}/admin/messages/${sent.data.id}/versions`);

    expect(afterClosed.status).toBe(403);
  });

  it('a message id from a different room is 404 on this room’s versions route', async () => {
    const app = getApp();
    const { adminA, roomId } = await openDisputeWithChatScenario(app);

    const missing = await adminA.get(`${API}/chat-rooms/${roomId}/admin/messages/0190a000-0000-7000-8000-000000000000/versions`);

    expect(missing.status).toBe(404);
  });
});
