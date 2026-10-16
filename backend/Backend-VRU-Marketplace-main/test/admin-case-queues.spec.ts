import sharp from 'sharp';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * §102 (scrutinizing area 4 — disputes and the admin's chat door):
 *
 *   A. an admin had no way to find an open dispute, a frozen order, or the chat room to read — every
 *      admin route needed an id nothing ever gave them, so disputes waited for a ruling forever;
 *   B. a frozen order under an open dispute could be TERMINATEd from the freeze route, and a later
 *      SHOP_WINS left it owing a refund — J3 says the dispute decides;
 *   C. an admin who is a party to the case used the admin doors on it — reading, among other things,
 *      the other side's unsent chat messages (§89 keeps those for a neutral admin only);
 *   D. the shop could still answer (and attach evidence) after the dispute was ruled;
 *   E. an override from SHOP_WINS to BUYER_WINS started a refund loop on a dispute left closed, so
 *      no admin could follow that loop.
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
  evidence: { id: string }[];
}
interface AdminDisputeBody extends DisputeBody {
  communityId: string;
  chatRoomId: string | null;
  reason: string;
}
interface FrozenQueueBody {
  id: string;
  disputeAwaitingRulingId: string | null;
  communityId: string;
}
interface NotificationBody {
  type: string;
  targetType: string | null;
  targetId: string | null;
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

// No endpoint lists the area reference data by id — the address form's value, read directly.
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


const REASON = 'ตรวจสอบข้อเท็จจริงครบถ้วนแล้วจึงตัดสินใจตามนี้';

async function uploadChatAttachment(client: Agent, roomId: string): Promise<string> {
  const response = await client
    .post(`${API}/chat-rooms/${roomId}/attachments`)
    .set(CSRF_HEADER, await csrfToken(client))
    .attach('file', await aJpegBuffer(), 'attachment.jpg');
  return (response.body as { fileId: string }).fileId;
}

async function post(client: Agent, path: string, body: Record<string, unknown> = {}) {
  return client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

async function idOf(client: Agent): Promise<string> {
  return ((await client.get(`${API}/auth/me`)).body as { id: string }).id;
}

async function notificationsOf(client: Agent): Promise<NotificationBody[]> {
  return ((await client.get(`${API}/notifications`)).body as { items: NotificationBody[] }).items;
}

/** A second community with an admin of its own — the one who must see none of community A's cases. */
async function adminOfAnotherCommunity(app: TestApp, superAdmin: Agent): Promise<Agent> {
  const communityId = await createCommunity(superAdmin, 'ชุมชนอ่างศิลา');
  const adminB = newClient(app);
  await assignAdmin(superAdmin, communityId, await registerVerified(app, adminB, 'admin-b@example.test'));
  return adminB;
}

async function communityIdOf(superAdmin: Agent, name: string): Promise<string> {
  const listed = (await superAdmin.get(`${API}/communities`)).body as { items: { id: string; name: string }[] };
  return listed.items.find((community) => community.name === name)!.id;
}

describe('§102 A — an admin finds the cases waiting on them', () => {
  it('lists the open disputes of the communities they run — with the chat room to read — and none of another community’s', async () => {
    const app = getApp();
    const { superAdmin, adminA, buyer, dispute, roomId } = await openDisputeWithChatScenario(app);
    const adminB = await adminOfAnotherCommunity(app, superAdmin);

    const queue = await adminA.get(`${API}/disputes/open`);
    expect(queue.status).toBe(200);
    const items = (queue.body as { items: AdminDisputeBody[] }).items;
    expect(items.map((item) => item.id)).toEqual([dispute.id]);
    expect(items[0]!.chatRoomId).toBe(roomId);
    expect(items[0]!.reason).toBe('สินค้าที่ได้รับไม่ตรงกับที่สั่งเลยครับ');
    expect(items[0]!.communityId).toBe(await communityIdOf(superAdmin, 'ชุมชนบางแสน'));

    expect(((await adminB.get(`${API}/disputes/open`)).body as { items: unknown[] }).items).toEqual([]);
    expect(((await buyer.get(`${API}/disputes/open`)).body as { items: unknown[] }).items).toEqual([]);
    expect(((await superAdmin.get(`${API}/disputes/open`)).body as { items: AdminDisputeBody[] }).items.map((item) => item.id)).toEqual([dispute.id]);
  });

  it('opens one dispute as its admin sees it — while it is open, and only in their community', async () => {
    const app = getApp();
    const { superAdmin, adminA, dispute, roomId } = await openDisputeWithChatScenario(app);
    const adminB = await adminOfAnotherCommunity(app, superAdmin);

    const seen = await adminA.get(`${API}/disputes/${dispute.id}/admin`);
    expect(seen.status).toBe(200);
    expect((seen.body as AdminDisputeBody).chatRoomId).toBe(roomId);
    expect((seen.body as AdminDisputeBody).evidence).toHaveLength(1);
    expect((await adminB.get(`${API}/disputes/${dispute.id}/admin`)).status).toBe(403);
    // §103 (owner's decision): opening one dispute is audited — it carries what the parties typed —
    // once, for the admin who opened it; the refused call above left nothing. The queue is not
    // audited, the same as every other review queue.
    expect((await adminA.get(`${API}/disputes/open`)).status).toBe(200);
    const viewed = await superAdmin.get(`${API}/admin/audit-log`).query({ action: 'DISPUTE_VIEWED' });
    expect((viewed.body as { items: unknown[] }).items).toEqual([
      expect.objectContaining({
        actorUserId: await idOf(adminA),
        targetType: 'DISPUTE',
        targetId: dispute.id,
        communityId: await communityIdOf(superAdmin, 'ชุมชนบางแสน'),
      }),
    ]);

    expect((await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON)).status).toBe(200);
    expect((await adminA.get(`${API}/disputes/${dispute.id}/admin`)).status).toBe(404);
    expect(((await adminA.get(`${API}/disputes/open`)).body as { items: unknown[] }).items).toEqual([]);
  });

  it('a new dispute notifies the admins of that shop’s community, and nobody else’s', async () => {
    const app = getApp();
    const { superAdmin, adminA, dispute } = await openDisputeWithChatScenario(app);
    const adminB = await adminOfAnotherCommunity(app, superAdmin);

    expect((await notificationsOf(adminA)).filter((n) => n.type === 'DISPUTE_AWAITING_RULING')).toEqual([
      expect.objectContaining({ targetType: 'DISPUTE', targetId: dispute.id }),
    ]);
    expect((await notificationsOf(adminB)).filter((n) => n.type === 'DISPUTE_AWAITING_RULING')).toEqual([]);
    // Super admins read every community's queue and are not paged for each case.
    expect((await notificationsOf(superAdmin)).filter((n) => n.type === 'DISPUTE_AWAITING_RULING')).toEqual([]);
  });

  it('lists the frozen orders of their communities, masked, pointing at the open dispute that decides them — and notifies them', async () => {
    const app = getApp();
    const { superAdmin, adminA, shopId, order, dispute } = await openDisputeWithChatScenario(app);
    const adminB = await adminOfAnotherCommunity(app, superAdmin);
    await suspendShop(app, shopId);

    const queue = await adminA.get(`${API}/frozen-orders`);
    expect(queue.status).toBe(200);
    const items = (queue.body as { items: (FrozenQueueBody & Record<string, unknown>)[] }).items;
    expect(items.map((item) => item.id)).toEqual([order.id]);
    expect(items[0]!.disputeAwaitingRulingId).toBe(dispute.id);
    expect(items[0]).not.toHaveProperty('recipientName');
    expect(items[0]).not.toHaveProperty('phone');
    expect(((await adminB.get(`${API}/frozen-orders`)).body as { items: unknown[] }).items).toEqual([]);

    expect((await notificationsOf(adminA)).filter((n) => n.type === 'ORDER_FROZEN_AWAITING_RULING')).toEqual([
      expect.objectContaining({ targetType: 'ORDER', targetId: order.id }),
    ]);
    expect((await notificationsOf(adminB)).filter((n) => n.type === 'ORDER_FROZEN_AWAITING_RULING')).toEqual([]);
  });
});

describe('§102 B — a frozen order with an open dispute is decided by the dispute (J3)', () => {
  it('the freeze route refuses to rule on it, and a SHOP_WINS ruling leaves it where it was', async () => {
    const app = getApp();
    const { adminA, shopId, buyer, order, dispute } = await openDisputeWithChatScenario(app);
    await suspendShop(app, shopId);

    const terminated = await post(adminA, `/orders/${order.id}/freeze-ruling`, { verdict: 'TERMINATE', reason: REASON });
    expect(terminated.status).toBe(409);

    expect((await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON)).status).toBe(200);
    // Released by the ruling (J3) and back where it was — not left owing a refund.
    const after = (await buyer.get(`${API}/orders/${order.id}`)).body as { status: string; displayStatus: string };
    expect(after).toMatchObject({ status: 'PAYMENT_SUBMITTED', displayStatus: 'PAYMENT_SUBMITTED' });
  });
});

describe('§102 B (review) — only a dispute still waiting for its ruling decides the freeze', () => {
  it('an order frozen after its dispute was ruled BUYER_WINS can still be released — the ruled dispute stays open for the refund loop, but decides nothing more', async () => {
    const app = getApp();
    const { adminA, shopId, order, dispute } = await openDisputeWithChatScenario(app);
    expect((await ruleDispute(adminA, dispute.id, 'BUYER_WINS', RULING_REASON)).status).toBe(200);
    await suspendShop(app, shopId);

    const queued = ((await adminA.get(`${API}/frozen-orders`)).body as { items: FrozenQueueBody[] }).items;
    expect(queued.map((item) => [item.id, item.disputeAwaitingRulingId])).toEqual([[order.id, null]]);

    // Before this, every way out was shut: this route (409), the dispute (already ruled), and the
    // refund loop (it does not run on a frozen order) — frozen for as long as the suspension lasted.
    expect((await post(adminA, `/orders/${order.id}/freeze-ruling`, { verdict: 'RELEASE', reason: REASON })).status).toBe(204);
  });
});

describe('§102 C — an admin who is a party to the case cannot use the admin doors on it', () => {
  it('the buyer, made an admin of that community later, is refused every admin read of their own case', async () => {
    const app = getApp();
    const { superAdmin, adminA, seller, shopId, buyer, dispute, roomId } = await openDisputeWithChatScenario(app);
    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    await emitAck(sellerSocket, 'joinRoom', { roomId });
    const sent = await emitAck<MessageBody>(sellerSocket, 'sendMessage', { roomId, content: 'ข้อความที่ร้านยกเลิกการส่งแล้ว' });
    if (!sent.ok) throw new Error('send failed');
    expect((await emitAck(sellerSocket, 'unsendMessage', { roomId, messageId: sent.data.id })).ok).toBe(true);
    const fileId = await uploadChatAttachment(seller, roomId);
    expect((await emitAck<MessageBody>(sellerSocket, 'sendMessage', { roomId, fileId })).ok).toBe(true);
    const slipId = ((await post(adminA, `/disputes/${dispute.id}/break-glass`, { reason: REASON })).body as { paymentSlips: { id: string }[] }).paymentSlips[0]!.id;
    await assignAdmin(superAdmin, await communityIdOf(superAdmin, 'ชุมชนบางแสน'), await idOf(buyer));

    expect((await readMessages(buyer, roomId)).status).toBe(403);
    expect((await buyer.get(`${API}/chat-rooms/${roomId}/admin/messages/${sent.data.id}/versions`)).status).toBe(403);
    expect((await buyer.get(`${API}/chat-rooms/${roomId}/admin/attachments/${fileId}`)).status).toBe(403);
    expect((await post(buyer, `/disputes/${dispute.id}/break-glass`, { reason: REASON })).status).toBe(403);
    expect((await post(buyer, `/disputes/${dispute.id}/break-glass/payment-slips/${slipId}`, { reason: REASON })).status).toBe(403);
    expect((await buyer.get(`${API}/disputes/${dispute.id}/admin-evidence/${dispute.evidence[0]!.id}`)).status).toBe(403);
    expect((await buyer.get(`${API}/disputes/${dispute.id}/admin`)).status).toBe(403);
    // Nor is it in their queue: it is somebody else's to rule on.
    expect(((await buyer.get(`${API}/disputes/open`)).body as { items: unknown[] }).items).toEqual([]);

    // Frozen now: queued for the neutral admin, not for the party — and only the neutral one is told.
    await suspendShop(app, shopId);
    expect(((await adminA.get(`${API}/frozen-orders`)).body as { items: unknown[] }).items).toHaveLength(1);
    expect(((await buyer.get(`${API}/frozen-orders`)).body as { items: unknown[] }).items).toEqual([]);
    expect((await notificationsOf(adminA)).filter((n) => n.type === 'ORDER_FROZEN_AWAITING_RULING')).toHaveLength(1);
    expect((await notificationsOf(buyer)).filter((n) => n.type === 'ORDER_FROZEN_AWAITING_RULING')).toEqual([]);
  });
});

describe('§102 D — the shop answers before the ruling, not after', () => {
  it('an answer sent after the dispute was ruled is refused, and nothing is attached', async () => {
    const app = getApp();
    const { adminA, seller, order, dispute } = await openDisputeWithChatScenario(app);
    expect((await ruleDispute(adminA, dispute.id, 'BUYER_WINS', RULING_REASON)).status).toBe(200);

    const late = await seller
      .post(`${API}/shops/me/orders/${order.id}/dispute/respond`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .field('response', 'ร้านขอชี้แจงหลังคำตัดสินออกมาแล้ว')
      .attach('files', await aJpegBuffer(), 'late.jpg');

    expect(late.status).toBe(409);
    const [current] = (await seller.get(`${API}/shops/me/orders/${order.id}/dispute`)).body as (DisputeBody & { shopResponse: string | null })[];
    expect(current!.shopResponse).toBeNull();
    expect(current!.evidence).toHaveLength(1);
  });
});

describe('§102 E — overriding to BUYER_WINS reopens the dispute for the refund loop it starts', () => {
  it('SHOP_WINS then an override to BUYER_WINS: the dispute is open again, admins can follow the loop, and the refund closes it', async () => {
    const app = getApp();
    const { superAdmin, adminA, seller, buyer, order, dispute, roomId } = await openDisputeWithChatScenario(app);
    expect((await ruleDispute(adminA, dispute.id, 'SHOP_WINS', RULING_REASON)).status).toBe(200);

    const overridden = await post(superAdmin, `/disputes/${dispute.id}/override`, { verdict: 'BUYER_WINS', reason: RULING_REASON });
    expect(overridden.status).toBe(200);
    expect((overridden.body as DisputeBody).closedAt).toBeNull();
    expect((await post(adminA, `/disputes/${dispute.id}/break-glass`, { reason: REASON })).status).toBe(200);
    expect((await readMessages(adminA, roomId)).status).toBe(200);

    await uploadRefundSlip(seller, order.id);
    expect((await post(buyer, `/orders/${order.id}/refund-received`)).status).toBe(200);
    const [closed] = (await buyer.get(`${API}/orders/${order.id}/dispute`)).body as DisputeBody[];
    expect(closed!.closedAt).not.toBeNull();
  });
});
