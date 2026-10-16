import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #66 (F4 · K14): the only WebSocket surface in this system.
 *
 * No clock anywhere in this ticket (#12's own testing decision), so every test here is seam 1
 * only — a real socket.io client holding real cookies, exactly as #12 requires, never a service
 * call and never a shortcut into `ChatService`.
 *
 * File attachments, unread counts and the length/rate limits are #67's own AC, not tested here.
 * Admin break-glass reading is #68's. Both are out of scope by the ticket split recorded in
 * `docs/PROGRESS.md`.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'other-buyer@example.test';

interface RoomBody {
  id: string;
  buyerId: string;
  shopOwnerUserId: string;
  createdAt: string;
}
interface MessageBody {
  id: string;
  roomId: string;
  senderId: string;
  orderId: string | null;
  content: string;
  createdAt: string;
}
interface RoomSummaryBody extends RoomBody {
  lastMessage: MessageBody | null;
}
interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
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

async function ban(client: Agent, userId: string, reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง') {
  return client
    .post(`${API}/admin/users/${userId}/ban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function suspendShop(superAdmin: Agent, shopId: string, reason = 'เหตุผลสำหรับทดสอบการระงับร้าน') {
  return superAdmin
    .post(`${API}/shops/${shopId}/suspend`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ reason });
}

/** One community, one approved shop, and a verified buyer — the baseline every test extends. */
async function scenario(app: TestApp): Promise<{ superAdmin: Agent; buyer: Agent; buyerId: string; seller: Agent; shopId: string; sellerId: string }> {
  const superAdmin = newClient(app);
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนทดสอบแชท');
  const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
  const buyer = newClient(app);
  const buyerId = await registerVerified(app, buyer, BUYER);

  return { superAdmin, buyer, buyerId, seller, shopId, sellerId };
}

const openSockets: ClientSocket[] = [];

afterEach(() => {
  for (const socket of openSockets) {
    socket.disconnect();
  }
  openSockets.length = 0;
});

/** Connects a `chatSocket()` and resolves once the handshake actually succeeds (or rejects). */
function connect(socket: ClientSocket): Promise<void> {
  openSockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error: Error) => reject(error));
    socket.connect();
  });
}

/** Attempts to connect and resolves with the `connect_error` instead of throwing. */
function expectConnectRejected(socket: ClientSocket): Promise<Error & { data?: ErrorBody }> {
  openSockets.push(socket);
  return new Promise((resolve) => {
    socket.once('connect_error', (error: Error & { data?: ErrorBody }) => resolve(error));
    socket.connect();
  });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: AckResponse<T>) => resolve(response));
  });
}

function waitForMessage(socket: ClientSocket): Promise<MessageBody> {
  return new Promise((resolve) => {
    socket.once('message', (data: MessageBody) => resolve(data));
  });
}

/** The disconnect reason, or `null` if the socket is still connected after `ms`. */
function waitForDisconnect(socket: ClientSocket, ms = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once('disconnect', (reason: string) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

/** A `message` pushed to this socket within `ms`, or `null` if none came. */
function messageWithin(socket: ClientSocket, ms = 500): Promise<MessageBody | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once('message', (data: MessageBody) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('#66 (F4 · K14): the room', () => {
  it('a buyer can open a room with a shop before any order exists', async () => {
    const app = getApp();
    const { buyer, buyerId, shopId, sellerId } = await scenario(app);
    const socket = chatSocket(app, buyer);
    await connect(socket);

    const response = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.buyerId).toBe(buyerId);
      expect(response.data.shopOwnerUserId).toBe(sellerId);
    }
  });

  it('opening a room with the same shop again returns the same room, not a new one', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const socket = chatSocket(app, buyer);
    await connect(socket);

    const first = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    const second = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.id).toBe(first.data.id);
    }
  });

  it('⚠️ the owner closing their shop and opening a new one keeps the same room and its history (K14/H12)', async () => {
    const app = getApp();
    const { buyer, seller, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    expect(opened.ok).toBe(true);
    const roomId = opened.ok ? opened.data.id : '';
    const sent = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: 'สอบถามก่อนปิดร้าน' });
    expect(sent.ok).toBe(true);

    // Close the shop, then open a brand new one under the same owner — H12's "reopen elsewhere".
    await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller));
    const community2 = await (async () => {
      const superAdmin = newClient(app);
      await signInAsSuperAdmin(app, superAdmin);
      return createCommunity(superAdmin, 'ชุมชนที่สอง');
    })();
    const reapplied = await seller
      .post(`${API}/shops`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ communityId: community2, name: 'ร้านทดสอบ 2' });
    const newShopId = (reapplied.body as { id: string }).id;
    await approveShop(app, newShopId);

    const reopened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId: newShopId });
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(reopened.data.id).toBe(roomId);
    }

    const history = await emitAck<{ items: MessageBody[] }>(buyerSocket, 'listMessages', { roomId });
    expect(history.ok).toBe(true);
    if (history.ok) {
      expect(history.data.items.map((m) => m.content)).toContain('สอบถามก่อนปิดร้าน');
    }
  });

  it('the owner of a closed, not-yet-reopened shop can still reach the old room directly (proves no join through Shop)', async () => {
    const app = getApp();
    const { buyer, seller, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller));

    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    const joined = await emitAck<RoomBody>(sellerSocket, 'joinRoom', { roomId });

    expect(joined.ok).toBe(true);
  });

  it('a message never needs an orderId — the schema does not force one', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    const sent = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'มีสินค้าตัวนี้ไหมครับ' });

    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.data.orderId).toBeNull();
    }
  });

  it('a message referencing an order that does not belong to this pair is rejected', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    const sent = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'อ้างอิงออเดอร์ที่ไม่มีจริง', orderId: newId() });

    expect(sent.ok).toBe(false);
    if (!sent.ok) {
      expect(sent.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('#66: WebSocket handshake authentication (B3 · invariant 8/9)', () => {
  it('connecting with no cookie at all is rejected at handshake, not connected then kicked', async () => {
    const app = getApp();
    const anonymous = newClient(app);
    const socket = chatSocket(app, anonymous);

    const error = await expectConnectRejected(socket);

    expect(error.data?.code).toBe('UNAUTHENTICATED');
    expect(socket.connected).toBe(false);
  });

  it('offering a token via query string is never accepted — only the cookie is read', async () => {
    const app = getApp();
    const { buyer } = await scenario(app);
    const socket = chatSocket(app, buyer);
    // Strip the cookie header the helper built and offer something in the query instead — proves
    // the middleware genuinely never reads `handshake.query`/`handshake.auth`, not merely that a
    // real cookie happens to win when both are present.
    socket.io.opts.extraHeaders = {};
    socket.io.opts.query = { token: 'whatever-a-client-might-try' };

    const error = await expectConnectRejected(socket);

    expect(error.data?.code).toBe('UNAUTHENTICATED');
  });

  it('a non-participant cannot join a real room even knowing its id — NOT_FOUND, never FORBIDDEN', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    const outsider = newClient(app);
    await registerVerified(app, outsider, OTHER_BUYER);
    const outsiderSocket = chatSocket(app, outsider);
    await connect(outsiderSocket);

    const joined = await emitAck<RoomBody>(outsiderSocket, 'joinRoom', { roomId });

    expect(joined.ok).toBe(false);
    if (!joined.ok) {
      expect(joined.error.code).toBe('NOT_FOUND');
    }
  });

  it('banned mid-conversation loses the socket already open — the server closes it (invariant 7)', async () => {
    const app = getApp();
    const { superAdmin, buyer, buyerId, shopId } = await scenario(app);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });

    // §83: before, the socket stayed open and only its *next* event answered ACCOUNT_BANNED —
    // a socket that never sent anything kept hearing the room forever. Now the ban itself closes
    // it; the reconnect that follows is refused at handshake (the next test).
    const disconnected = waitForDisconnect(socket);
    await ban(superAdmin, buyerId);

    expect(await disconnected).toBe('io server disconnect');
  });

  it('a banned user reconnecting is rejected at that new connection too', async () => {
    const app = getApp();
    const { superAdmin, buyer, buyerId } = await scenario(app);
    const first = chatSocket(app, buyer);
    await connect(first);
    first.disconnect();

    await ban(superAdmin, buyerId);

    const second = chatSocket(app, buyer);
    const error = await expectConnectRejected(second);

    expect(error.data?.code).toBe('ACCOUNT_BANNED');
  });

  it('J2: a suspended shop’s owner can still chat with a buyer who has an open room', async () => {
    const app = getApp();
    const { superAdmin, buyer, seller, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    await suspendShop(superAdmin, shopId);

    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    const joined = await emitAck<RoomBody>(sellerSocket, 'joinRoom', { roomId });
    const sent = await emitAck<MessageBody>(sellerSocket, 'sendMessage', { roomId, content: 'ร้านถูกระงับแต่ยังตอบได้' });

    expect(joined.ok).toBe(true);
    expect(sent.ok).toBe(true);
  });
});

describe('#66: messages and history', () => {
  it('a message sent while the other party is offline is there when they connect', async () => {
    const app = getApp();
    const { buyer, seller, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    // The seller is never connected at this point — nothing in ChatService requires it.
    const sent = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: 'ทักตอนร้านออฟไลน์' });
    expect(sent.ok).toBe(true);

    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    const joined = await emitAck<RoomBody>(sellerSocket, 'joinRoom', { roomId });
    expect(joined.ok).toBe(true);
    const history = await emitAck<{ items: MessageBody[] }>(sellerSocket, 'listMessages', { roomId });

    expect(history.ok).toBe(true);
    if (history.ok) {
      expect(history.data.items.map((m) => m.content)).toContain('ทักตอนร้านออฟไลน์');
    }
  });

  it('both parties online: the other side receives the message over the socket, no HTTP call needed', async () => {
    const app = getApp();
    const { buyer, seller, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    const sellerSocket = chatSocket(app, seller);
    await connect(buyerSocket);
    await connect(sellerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';
    await emitAck<RoomBody>(sellerSocket, 'joinRoom', { roomId });

    const pushed = waitForMessage(sellerSocket);
    await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: 'ข้อความสดๆ' });
    const received = await pushed;

    expect(received.content).toBe('ข้อความสดๆ');
  });

  it('history reads newest first (§83), and an oversized limit is clamped rather than rejected', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'หนึ่ง' });
    await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'สอง' });
    await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'สาม' });

    const page = await emitAck<{ items: MessageBody[]; hasMore: boolean; nextCursor: string | null }>(socket, 'listMessages', {
      roomId,
      limit: 999,
    });

    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.data.items.map((m) => m.content)).toEqual(['สาม', 'สอง', 'หนึ่ง']);
      expect(page.data.hasMore).toBe(false);
    }
  });

  it('listRooms returns the caller’s rooms with the latest message attached', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';
    await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'ข้อความล่าสุด' });

    const rooms = await emitAck<{ items: RoomSummaryBody[] }>(socket, 'listRooms', {});

    expect(rooms.ok).toBe(true);
    if (rooms.ok) {
      const room = rooms.data.items.find((r) => r.id === roomId);
      expect(room?.lastMessage?.content).toBe('ข้อความล่าสุด');
    }
  });
});

describe('§108 — an inbox puts the room with the newest message first', () => {
  it('moves an old room to the top when a message arrives, and pages through every room exactly once', async () => {
    const app = getApp();
    const { buyer, shopId, seller } = await scenario(app);
    const buyers = [buyer];
    for (const email of ['buyer-two@example.test', 'buyer-three@example.test']) {
      const another = newClient(app);
      await registerVerified(app, another, email);
      buyers.push(another);
    }
    // Rooms opened a minute apart, oldest first — the test clock does not move on its own.
    const roomIds: string[] = [];
    const buyerSockets: ClientSocket[] = [];
    for (const each of buyers) {
      app.clock.advanceByMinutes(1);
      const socket = chatSocket(app, each);
      await connect(socket);
      const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
      roomIds.push(opened.ok ? opened.data.id : '');
      buyerSockets.push(socket);
    }
    app.clock.advanceByMinutes(1);
    await emitAck(buyerSockets[0]!, 'sendMessage', { roomId: roomIds[0], content: 'ห้องเก่าที่สุดมีข้อความใหม่' });

    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    const first = await emitAck<{ items: RoomSummaryBody[]; nextCursor: string | null }>(sellerSocket, 'listRooms', { limit: 2 });
    const firstPage = first.ok ? first.data : { items: [], nextCursor: null };
    const second = await emitAck<{ items: RoomSummaryBody[]; nextCursor: string | null }>(sellerSocket, 'listRooms', { limit: 2, cursor: firstPage.nextCursor });

    expect(firstPage.items.map((r) => r.id)).toEqual([roomIds[0], roomIds[2]]);
    expect(second.ok ? second.data.items.map((r) => r.id) : []).toEqual([roomIds[1]]);
  });
});

describe('code review of topic 11 (§83)', () => {
  it('🚨 a ban closes a socket that is only listening — it hears nothing said after the ban', async () => {
    const app = getApp();
    const { superAdmin, buyer, buyerId, seller, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';
    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    await emitAck<RoomBody>(sellerSocket, 'joinRoom', { roomId });

    const disconnected = waitForDisconnect(buyerSocket);
    expect((await ban(superAdmin, buyerId)).status).toBe(204);
    expect(await disconnected).toBe('io server disconnect');

    const heard = messageWithin(buyerSocket);
    const sent = await emitAck<MessageBody>(sellerSocket, 'sendMessage', { roomId, content: 'พูดหลังผู้ซื้อโดนแบน' });
    expect(sent.ok).toBe(true);
    expect(await heard).toBeNull();
  });

  it('🚨 logging out closes that session’s sockets — and only that session’s, not the same person’s other device', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const otherDevice = newClient(app);
    expect((await login(otherDevice, BUYER)).status).toBe(200);

    const loggingOutSocket = chatSocket(app, buyer);
    await connect(loggingOutSocket);
    const otherDeviceSocket = chatSocket(app, otherDevice);
    await connect(otherDeviceSocket);
    const opened = await emitAck<RoomBody>(loggingOutSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';
    await emitAck<RoomBody>(otherDeviceSocket, 'joinRoom', { roomId });

    const loggingOutClosed = waitForDisconnect(loggingOutSocket);
    const otherDeviceClosed = waitForDisconnect(otherDeviceSocket, 800);
    const loggedOut = await buyer.post(`${API}/auth/logout`).set(CSRF_HEADER, await csrfToken(buyer));
    expect(loggedOut.status).toBe(204);

    expect(await loggingOutClosed).toBe('io server disconnect');
    expect(await otherDeviceClosed).toBeNull();
    expect(otherDeviceSocket.connected).toBe(true);
  });

  it('🚨 a handshake from any origin other than the configured frontend is refused (invariant 9 — CORS never covered WebSocket)', async () => {
    const app = getApp();
    const { buyer } = await scenario(app);

    const foreign = await expectConnectRejected(chatSocket(app, buyer, { origin: 'https://evil-sibling.example' }));
    expect(foreign).toBeInstanceOf(Error);

    // `FRONTEND_BASE_URL` in test/helpers/test-env.ts.
    await expect(connect(chatSocket(app, buyer, { origin: 'http://localhost:5173' }))).resolves.toBeUndefined();
  });

  it('two tabs opening the same room at the same instant both get that one room — never a 500', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const first = chatSocket(app, buyer);
    const second = chatSocket(app, buyer);
    await connect(first);
    await connect(second);

    // Hold each "does this room exist yet?" read until both tabs have made it, so both see none
    // and both go on to create — the interleaving that answered one tab with INTERNAL_ERROR.
    const rooms = app.prisma.chatRoom;
    const realFindUnique = rooms.findUnique.bind(rooms);
    let waiting = 0;
    let releaseBoth: () => void = () => undefined;
    const bothHaveLooked = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    vi.spyOn(rooms, 'findUnique').mockImplementation(((args: Parameters<typeof realFindUnique>[0]) => {
      const lookup = realFindUnique(args);
      waiting += 1;
      if (waiting === 2) releaseBoth();
      return waiting <= 2 ? bothHaveLooked.then(() => lookup) : lookup;
    }) as unknown as typeof rooms.findUnique);

    const [a, b] = await Promise.all([
      emitAck<RoomBody>(first, 'openRoomWithShop', { shopId }),
      emitAck<RoomBody>(second, 'openRoomWithShop', { shopId }),
    ]);

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.data.id).toBe(b.data.id);
    }
    expect(await app.prisma.chatRoom.count()).toBe(1);
  });

  it('the first page of history is the newest messages — opening a long room shows what was said last', async () => {
    const app = getApp();
    const { buyer, seller, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';
    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    for (let i = 1; i <= 8; i += 1) {
      await emitAck<MessageBody>(sellerSocket, 'sendMessage', { roomId, content: `ข้อความที่ ${String(i)}` });
    }

    const firstPage = await emitAck<{ items: MessageBody[]; nextCursor: string | null; hasMore: boolean }>(buyerSocket, 'listMessages', { roomId, limit: 3 });
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) return;
    expect(firstPage.data.items.map((m) => m.content)).toEqual(['ข้อความที่ 8', 'ข้อความที่ 7', 'ข้อความที่ 6']);
    expect(firstPage.data.hasMore).toBe(true);

    const secondPage = await emitAck<{ items: MessageBody[] }>(buyerSocket, 'listMessages', { roomId, limit: 3, cursor: firstPage.data.nextCursor });
    expect(secondPage.ok && secondPage.data.items.map((m) => m.content)).toEqual(['ข้อความที่ 5', 'ข้อความที่ 4', 'ข้อความที่ 3']);
  });

  it('🚨 reading an older page never marks a newer, unseen message read', async () => {
    const app = getApp();
    const { buyer, seller, shopId } = await scenario(app);
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    const opened = await emitAck<RoomBody>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';
    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    for (let i = 1; i <= 6; i += 1) {
      await emitAck<MessageBody>(sellerSocket, 'sendMessage', { roomId, content: `ข้อความที่ ${String(i)}` });
    }

    const newest = await emitAck<{ nextCursor: string | null }>(buyerSocket, 'listMessages', { roomId, limit: 3 });
    const cursor = newest.ok ? newest.data.nextCursor : null;
    app.clock.advanceByMinutes(1);
    await emitAck<MessageBody>(sellerSocket, 'sendMessage', { roomId, content: 'ข้อความใหม่ที่ยังไม่ได้อ่าน' });
    app.clock.advanceByMinutes(1);

    await emitAck(buyerSocket, 'listMessages', { roomId, limit: 3, cursor });

    const rooms = await emitAck<{ items: { id: string; unreadCount: number }[] }>(buyerSocket, 'listRooms', {});
    expect(rooms.ok && rooms.data.items.find((r) => r.id === roomId)?.unreadCount).toBe(1);
  });

  it('a rejected orderId is explained in Thai, like every other message this system shows (L4)', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const socket = chatSocket(app, buyer);
    await connect(socket);
    const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
    const roomId = opened.ok ? opened.data.id : '';

    const sent = await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content: 'อ้างอิงออเดอร์', orderId: newId() });

    expect(sent.ok).toBe(false);
    if (!sent.ok) {
      expect(sent.error.fieldErrors?.orderId).toMatch(/[\u0E00-\u0E7F]/);
    }
  });
});
