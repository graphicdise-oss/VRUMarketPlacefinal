import sharp from 'sharp';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { ERASED_CHAT_MESSAGE_PLACEHOLDER } from '../src/account-erasure/erasure-placeholders.js';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import type { ErrorBody } from '../src/common/errors/error-payload.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { rejectShopAs } from './helpers/review.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §106 — the admin↔shop chat the project owner asked for once §105 kept admin accounts out of
 * buyers' rooms: one room per shop, shared by every admin of the shop's community (plus super
 * admin), opened by either side, pictures allowed, edits kept as history, unsend within 15
 * minutes (admins still read the original), the shop sees only "an admin", every admin write is
 * audited, and the community wall holds exactly as it does for every other admin power.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const ADMIN_A = 'admin-a@example.test';
const ADMIN_A2 = 'admin-a2@example.test';
const ADMIN_B = 'admin-b@example.test';
const BUYER = 'buyer@example.test';

type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };
interface RoomBody {
  id: string;
  shopId: string;
  communityId: string;
  side: 'SHOP' | 'ADMIN';
}
interface MessageBody {
  id: string;
  roomId: string;
  senderSide: 'SHOP' | 'ADMIN';
  senderId: string | null;
  fileId: string | null;
  content: string;
  editedAt: string | null;
  unsentAt: string | null;
}
interface RoomSummaryBody {
  id: string;
  shopId: string;
  shopName: string;
  communityId: string;
  unreadCount: number;
  lastMessage: MessageBody | null;
}
interface Page<T> {
  items: T[];
}

async function post(client: Agent, path: string, body: object = {}) {
  return client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client)).send(body);
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: AckResponse<T>) => resolve(response));
  });
}

function dataOf<T>(response: AckResponse<T>): T {
  if (!response.ok) {
    throw new Error(`event failed: ${response.error.code}`);
  }
  return response.data;
}

async function connected(app: TestApp, client: Agent): Promise<ClientSocket> {
  const socket = chatSocket(app, client);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error: Error) => reject(error));
    socket.connect();
  });

  return socket;
}

/** The next `event` pushed to this socket, or a rejection after `ms`. */
function nextPush<T>(socket: ClientSocket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${String(ms)}ms`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function aJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 10, g: 120, b: 30 } } })
    .jpeg()
    .toBuffer();
}

/**
 * Two communities, each with its own admins; one shop in community A. Everyone signs in through
 * the real doors — the only database write is the super admin's role, which has no endpoint.
 */
async function world(app: TestApp, options: { approve?: boolean } = {}) {
  const superAdmin = app.client;
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  const communityA = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const communityB = ((await post(superAdmin, '/communities', { name: 'ชุมชนอ่างศิลา', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;

  const adminA = newClient(app);
  const adminAId = await registerVerified(app, adminA, ADMIN_A);
  const adminA2 = newClient(app);
  const adminA2Id = await registerVerified(app, adminA2, ADMIN_A2);
  const adminB = newClient(app);
  const adminBId = await registerVerified(app, adminB, ADMIN_B);
  expect((await post(superAdmin, `/communities/${communityA}/admins`, { userId: adminAId })).status).toBe(201);
  expect((await post(superAdmin, `/communities/${communityA}/admins`, { userId: adminA2Id })).status).toBe(201);
  expect((await post(superAdmin, `/communities/${communityB}/admins`, { userId: adminBId })).status).toBe(201);

  const seller = newClient(app);
  const sellerId = await registerVerified(app, seller, SELLER);
  const shopId = ((await post(seller, '/shops', { communityId: communityA, name: 'ร้านผ้าทอบางแสน' })).body as { id: string }).id;
  if (options.approve ?? true) {
    await approveShop(app, shopId);
  }

  return { superAdmin, communityA, communityB, adminA, adminAId, adminA2, adminB, seller, sellerId, shopId };
}

type World = Awaited<ReturnType<typeof world>>;

/** The shop owner opens the room with their shop's admins and sends one line. */
async function shopOpensAndSays(app: TestApp, w: World, content: string): Promise<{ socket: ClientSocket; room: RoomBody; message: MessageBody }> {
  const socket = await connected(app, w.seller);
  const room = dataOf(await emitAck<RoomBody>(socket, 'openShopAdminRoom', { shopId: w.shopId }));
  const message = dataOf(await emitAck<MessageBody>(socket, 'sendShopAdminMessage', { roomId: room.id, content }));

  return { socket, room, message };
}

async function notificationTypes(client: Agent): Promise<string[]> {
  const listed = await client.get(`${API}/notifications`);
  return (listed.body as Page<{ type: string }>).items.map((n) => n.type);
}

describe('the shop starts a conversation with its community’s admins (§106)', () => {
  it('lands in the community’s shared inbox, unread, and reading it clears it for every admin of that community', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket: shopSocket, room } = await shopOpensAndSays(app, w, 'สอบถามครับ ทำไมสินค้าผ้าทอถูกปฏิเสธ');
    shopSocket.disconnect();
    expect(room).toMatchObject({ shopId: w.shopId, communityId: w.communityA, side: 'SHOP' });

    const a = await connected(app, w.adminA);
    const inbox = dataOf(await emitAck<Page<RoomSummaryBody>>(a, 'listShopAdminRooms', {}));
    expect(inbox.items).toEqual([expect.objectContaining({ id: room.id, shopId: w.shopId, shopName: 'ร้านผ้าทอบางแสน', communityId: w.communityA, unreadCount: 1 })]);

    const history = dataOf(await emitAck<Page<MessageBody>>(a, 'listShopAdminMessages', { roomId: room.id }));
    a.disconnect();
    // Admins see who wrote what — the shop owner's own id on the shop's side.
    expect(history.items).toEqual([expect.objectContaining({ senderSide: 'SHOP', senderId: w.sellerId, content: 'สอบถามครับ ทำไมสินค้าผ้าทอถูกปฏิเสธ' })]);

    // One inbox per community (the owner's answer): admin A read it, so it is read for admin A2 too.
    const a2 = await connected(app, w.adminA2);
    const inboxOfA2 = dataOf(await emitAck<Page<RoomSummaryBody>>(a2, 'listShopAdminRooms', {}));
    a2.disconnect();
    expect(inboxOfA2.items[0]?.unreadCount).toBe(0);
  });

  it('notifies every admin of the community once per unread room — and not the super admin', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room } = await shopOpensAndSays(app, w, 'สวัสดีครับแอดมิน');
    await emitAck(socket, 'sendShopAdminMessage', { roomId: room.id, content: 'ข้อความที่สอง' });
    socket.disconnect();

    for (const admin of [w.adminA, w.adminA2]) {
      expect((await notificationTypes(admin)).filter((t) => t === 'SHOP_ADMIN_CHAT_FROM_SHOP')).toHaveLength(1);
    }
    expect(await notificationTypes(w.adminB)).not.toContain('SHOP_ADMIN_CHAT_FROM_SHOP');
    expect(await notificationTypes(w.superAdmin)).not.toContain('SHOP_ADMIN_CHAT_FROM_SHOP');
  });
});

describe('an admin starts a conversation with a shop (§106)', () => {
  it('reaches the shop as "an admin" — no admin id — with a notification, and the send is audited', async () => {
    const app = getApp();
    const w = await world(app);
    const shopSocket = await connected(app, w.seller);
    const shopRoom = dataOf(await emitAck<RoomBody>(shopSocket, 'openShopAdminRoom', { shopId: w.shopId }));
    await emitAck(shopSocket, 'joinShopAdminRoom', { roomId: shopRoom.id });
    const pushed = nextPush<MessageBody>(shopSocket, 'shopAdminMessage');

    const a = await connected(app, w.adminA);
    const adminRoom = dataOf(await emitAck<RoomBody>(a, 'openShopAdminRoom', { shopId: w.shopId }));
    expect(adminRoom).toMatchObject({ id: shopRoom.id, side: 'ADMIN' });
    const sent = dataOf(await emitAck<MessageBody>(a, 'sendShopAdminMessage', { roomId: adminRoom.id, content: 'รบกวนส่งรูปฉลากสินค้าเพิ่มครับ' }));
    a.disconnect();

    // The admin's own ack names them; the shop never learns which admin it was.
    expect(sent).toMatchObject({ senderSide: 'ADMIN', senderId: w.adminAId });
    expect(await pushed).toMatchObject({ senderSide: 'ADMIN', senderId: null, content: 'รบกวนส่งรูปฉลากสินค้าเพิ่มครับ' });
    const shopView = dataOf(await emitAck<Page<MessageBody>>(shopSocket, 'listShopAdminMessages', { roomId: shopRoom.id }));
    shopSocket.disconnect();
    expect(shopView.items[0]).toMatchObject({ senderSide: 'ADMIN', senderId: null });

    const notices = (await w.seller.get(`${API}/notifications`)).body as Page<{ type: string; targetType: string; targetId: string }>;
    expect(notices.items).toContainEqual(expect.objectContaining({ type: 'SHOP_ADMIN_CHAT_FROM_ADMIN', targetType: 'SHOP', targetId: w.shopId }));

    const audited = await w.superAdmin.get(`${API}/admin/audit-log`).query({ action: 'SHOP_ADMIN_CHAT_MESSAGE_SENT' });
    expect((audited.body as Page<unknown>).items).toEqual([
      expect.objectContaining({ actorUserId: w.adminAId, targetType: 'SHOP', targetId: w.shopId, communityId: w.communityA }),
    ]);
  });
});

describe('§108 — the shared inbox’s read state belongs to the community', () => {
  it('leaves the community’s unread count alone when the super admin only reads — and clears it when the super admin replies', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room } = await shopOpensAndSays(app, w, 'ถึงแอดมิน');
    socket.disconnect();

    const s = await connected(app, w.superAdmin);
    await emitAck(s, 'listShopAdminMessages', { roomId: room.id });
    const a = await connected(app, w.adminA);
    const afterGlance = dataOf(await emitAck<Page<RoomSummaryBody>>(a, 'listShopAdminRooms', {}));
    // Replying is handling it, whoever replies.
    await emitAck(s, 'sendShopAdminMessage', { roomId: room.id, content: 'super admin รับเรื่องแล้วครับ' });
    const afterReply = dataOf(await emitAck<Page<RoomSummaryBody>>(a, 'listShopAdminRooms', {}));
    s.disconnect();
    a.disconnect();

    expect(afterGlance.items[0]?.unreadCount).toBe(1);
    expect(afterReply.items[0]?.unreadCount).toBe(0);
  });

  it('clears every community admin’s notice for the room once one of them reads it — not when the super admin only reads', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room } = await shopOpensAndSays(app, w, 'ถึงแอดมิน');
    socket.disconnect();
    const unreadNotices = async (admin: Agent): Promise<number> => {
      const listed = (await admin.get(`${API}/notifications`)).body as Page<{ type: string; readAt: string | null }>;
      return listed.items.filter((n) => n.type === 'SHOP_ADMIN_CHAT_FROM_SHOP' && n.readAt === null).length;
    };

    const s = await connected(app, w.superAdmin);
    await emitAck(s, 'listShopAdminMessages', { roomId: room.id });
    s.disconnect();
    expect(await unreadNotices(w.adminA2)).toBe(1);

    const a = await connected(app, w.adminA);
    await emitAck(a, 'listShopAdminMessages', { roomId: room.id });
    a.disconnect();
    expect(await unreadNotices(w.adminA2)).toBe(0);
    expect(await unreadNotices(w.adminA)).toBe(0);
  });

  it('puts the room with the newest message first, and pages through every room exactly once', async () => {
    const app = getApp();
    const w = await world(app);
    const shopIds = [w.shopId];
    for (const [i, email] of ['second-seller@example.test', 'third-seller@example.test'].entries()) {
      const owner = newClient(app);
      await registerVerified(app, owner, email);
      shopIds.push(((await post(owner, '/shops', { communityId: w.communityA, name: `ร้านที่ ${String(i + 2)}` })).body as { id: string }).id);
    }
    // Rooms opened a minute apart, oldest first — the test clock does not move on its own.
    const a = await connected(app, w.adminA);
    const roomIds: string[] = [];
    for (const shopId of shopIds) {
      app.clock.advanceByMinutes(1);
      roomIds.push(dataOf(await emitAck<RoomBody>(a, 'openShopAdminRoom', { shopId })).id);
    }
    app.clock.advanceByMinutes(1);
    const { socket } = await shopOpensAndSays(app, w, 'ห้องเก่าที่สุดมีข้อความใหม่');
    socket.disconnect();

    const first = dataOf(await emitAck<Page<RoomSummaryBody> & { nextCursor: string | null }>(a, 'listShopAdminRooms', { limit: 2 }));
    const second = dataOf(await emitAck<Page<RoomSummaryBody>>(a, 'listShopAdminRooms', { limit: 2, cursor: first.nextCursor }));
    a.disconnect();

    expect(first.items.map((r) => r.id)).toEqual([roomIds[0], roomIds[2]]);
    expect(second.items.map((r) => r.id)).toEqual([roomIds[1]]);
  });
});

describe('the community wall holds (§106 · invariant 1)', () => {
  it('lets no admin of community B, and no ordinary user, reach community A’s shop — the same NOT_FOUND as a room that does not exist', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room, message } = await shopOpensAndSays(app, w, 'ข้อความถึงแอดมินชุมชนบางแสน');
    const picture = await w.seller
      .post(`${API}/shop-admin-chat-rooms/${room.id}/attachments`)
      .set(CSRF_HEADER, await csrfToken(w.seller))
      .attach('file', await aJpeg(), 'label.jpg');
    expect(picture.status).toBe(201);
    const fileId = (picture.body as { fileId: string }).fileId;
    await emitAck(socket, 'sendShopAdminMessage', { roomId: room.id, fileId });
    socket.disconnect();

    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    for (const outsider of [w.adminB, buyer]) {
      const s = await connected(app, outsider);
      const attempts = [
        await emitAck(s, 'openShopAdminRoom', { shopId: w.shopId }),
        await emitAck(s, 'joinShopAdminRoom', { roomId: room.id }),
        await emitAck(s, 'sendShopAdminMessage', { roomId: room.id, content: 'ข้ามชุมชน' }),
        await emitAck(s, 'listShopAdminMessages', { roomId: room.id }),
        await emitAck(s, 'listShopAdminMessageVersions', { roomId: room.id, messageId: message.id }),
        await emitAck(s, 'editShopAdminMessage', { roomId: room.id, messageId: message.id, content: 'แก้แทน' }),
      ];
      const inbox = dataOf(await emitAck<Page<RoomSummaryBody>>(s, 'listShopAdminRooms', {}));
      s.disconnect();

      for (const attempt of attempts) {
        expect(attempt).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      }
      expect(inbox.items).toEqual([]);
      expect((await outsider.get(`${API}/shop-admin-chat-rooms/${room.id}/attachments/${fileId}`)).status).toBe(404);
    }

    // The community's own admin, and the super admin, see the same picture.
    expect((await w.adminA.get(`${API}/shop-admin-chat-rooms/${room.id}/attachments/${fileId}`)).status).toBe(200);
    expect((await w.superAdmin.get(`${API}/shop-admin-chat-rooms/${room.id}/attachments/${fileId}`)).status).toBe(200);
  });

  it('lets the super admin into every community’s rooms', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room } = await shopOpensAndSays(app, w, 'ถึงแอดมินครับ');
    socket.disconnect();

    const s = await connected(app, w.superAdmin);
    const inbox = dataOf(await emitAck<Page<RoomSummaryBody>>(s, 'listShopAdminRooms', {}));
    const reply = await emitAck<MessageBody>(s, 'sendShopAdminMessage', { roomId: room.id, content: 'รับทราบครับ' });
    s.disconnect();

    expect(inbox.items.map((r) => r.id)).toEqual([room.id]);
    expect(reply).toMatchObject({ ok: true, data: { senderSide: 'ADMIN' } });
  });

  it('drops an admin removed from the community on the spot: no more pushes, and the room is NOT_FOUND', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket: shopSocket, room } = await shopOpensAndSays(app, w, 'ข้อความแรก');
    const a = await connected(app, w.adminA);
    const a2 = await connected(app, w.adminA2);
    await emitAck(a, 'joinShopAdminRoom', { roomId: room.id });
    await emitAck(a2, 'joinShopAdminRoom', { roomId: room.id });
    let removedAdminHeard = false;
    a.on('shopAdminMessage', () => {
      removedAdminHeard = true;
    });

    const revoked = await w.superAdmin.delete(`${API}/communities/${w.communityA}/admins/${w.adminAId}`).set(CSRF_HEADER, await csrfToken(w.superAdmin));
    expect(revoked.status).toBe(204);

    const stillAdmin = nextPush<MessageBody>(a2, 'shopAdminMessage');
    await emitAck(shopSocket, 'sendShopAdminMessage', { roomId: room.id, content: 'ข้อความหลังถอดแอดมิน' });
    // Both admins sat in the same room and the push is one emit: once A2 has it, A would have too.
    await stillAdmin;
    const afterRevoke = await emitAck(a, 'listShopAdminMessages', { roomId: room.id });
    for (const s of [shopSocket, a, a2]) s.disconnect();

    expect(removedAdminHeard).toBe(false);
    expect(afterRevoke).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('edits keep their history, unsend hides from the shop but not from admins (§106)', () => {
  it('shows both sides every version of an edited message', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room, message } = await shopOpensAndSays(app, w, 'ขอเปิดร้านขายผ้าทอครับ');
    const edited = dataOf(await emitAck<MessageBody>(socket, 'editShopAdminMessage', { roomId: room.id, messageId: message.id, content: 'ขอเปิดร้านขายผ้าทอมือครับ' }));
    const shopVersions = dataOf(await emitAck<Page<{ content: string }>>(socket, 'listShopAdminMessageVersions', { roomId: room.id, messageId: message.id }));
    socket.disconnect();
    const a = await connected(app, w.adminA);
    const adminVersions = dataOf(await emitAck<Page<{ content: string }>>(a, 'listShopAdminMessageVersions', { roomId: room.id, messageId: message.id }));
    a.disconnect();

    expect(edited.editedAt).not.toBeNull();
    for (const versions of [shopVersions, adminVersions]) {
      expect(versions.items.map((v) => v.content)).toEqual(['ขอเปิดร้านขายผ้าทอมือครับ', 'ขอเปิดร้านขายผ้าทอครับ']);
    }
  });

  it('unsent within 15 minutes: the shop sees an empty shell and no history, every admin still reads the original — whichever side unsent it', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket: shopSocket, room, message: fromShop } = await shopOpensAndSays(app, w, 'เบอร์ผม 0812345678');
    const a = await connected(app, w.adminA);
    const fromAdmin = dataOf(await emitAck<MessageBody>(a, 'sendShopAdminMessage', { roomId: room.id, content: 'ข้อความที่แอดมินจะยกเลิก' }));

    expect((await emitAck(shopSocket, 'unsendShopAdminMessage', { roomId: room.id, messageId: fromShop.id })).ok).toBe(true);
    expect((await emitAck(a, 'unsendShopAdminMessage', { roomId: room.id, messageId: fromAdmin.id })).ok).toBe(true);

    const shopView = dataOf(await emitAck<Page<MessageBody>>(shopSocket, 'listShopAdminMessages', { roomId: room.id }));
    const shopHistory = await emitAck(shopSocket, 'listShopAdminMessageVersions', { roomId: room.id, messageId: fromShop.id });
    const a2 = await connected(app, w.adminA2);
    const adminView = dataOf(await emitAck<Page<MessageBody>>(a2, 'listShopAdminMessages', { roomId: room.id }));
    for (const s of [shopSocket, a, a2]) s.disconnect();

    for (const shown of shopView.items) {
      expect(shown).toMatchObject({ content: '', fileId: null });
      expect(shown.unsentAt).not.toBeNull();
    }
    expect(shopHistory).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(adminView.items.map((m) => m.content).sort()).toEqual(['ข้อความที่แอดมินจะยกเลิก', 'เบอร์ผม 0812345678'].sort());
    expect(adminView.items.every((m) => m.unsentAt !== null)).toBe(true);

    const audited = await w.superAdmin.get(`${API}/admin/audit-log`).query({ action: 'SHOP_ADMIN_CHAT_MESSAGE_UNSENT' });
    expect((audited.body as Page<unknown>).items).toHaveLength(1);
  });

  it('refuses an unsend after 15 minutes — the message can still be edited', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room, message } = await shopOpensAndSays(app, w, 'ข้อความเก่า');
    app.clock.advanceByMinutes(16);
    // The access token is 15 minutes; the socket re-reads the session on every event.
    socket.disconnect();
    await login(w.seller, SELLER);
    const again = await connected(app, w.seller);

    const late = await emitAck(again, 'unsendShopAdminMessage', { roomId: room.id, messageId: message.id });
    const edit = await emitAck(again, 'editShopAdminMessage', { roomId: room.id, messageId: message.id, content: 'ข้อความเก่า (แก้แล้ว)' });
    again.disconnect();

    expect(late).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(edit.ok).toBe(true);
  });

  it('audits an admin’s edit', async () => {
    const app = getApp();
    const w = await world(app);
    const a = await connected(app, w.adminA);
    const room = dataOf(await emitAck<RoomBody>(a, 'openShopAdminRoom', { shopId: w.shopId }));
    const sent = dataOf(await emitAck<MessageBody>(a, 'sendShopAdminMessage', { roomId: room.id, content: 'กรุณาแก้ชื่อสินค้า' }));
    await emitAck(a, 'editShopAdminMessage', { roomId: room.id, messageId: sent.id, content: 'กรุณาแก้ชื่อสินค้าให้ตรงกับของจริง' });
    a.disconnect();

    const audited = await w.superAdmin.get(`${API}/admin/audit-log`).query({ action: 'SHOP_ADMIN_CHAT_MESSAGE_EDITED' });
    expect((audited.body as Page<unknown>).items).toEqual([expect.objectContaining({ targetId: w.shopId, communityId: w.communityA })]);
  });
});

describe('every shop status can talk to its admins; a closed shop only reads (§106)', () => {
  it('lets a shop still waiting for approval ask about its application', async () => {
    const app = getApp();
    const w = await world(app, { approve: false });
    const { socket, message } = await shopOpensAndSays(app, w, 'ใบสมัครร้านผมต้องเพิ่มเอกสารอะไรไหมครับ');
    socket.disconnect();

    expect(message.senderSide).toBe('SHOP');
  });

  it('lets a rejected shop ask why, and its admins answer — a rejection is not a closed shop', async () => {
    const app = getApp();
    const w = await world(app, { approve: false });
    expect((await rejectShopAs(w.superAdmin, w.shopId, 'เอกสารยืนยันตัวตนไม่ชัดเจน กรุณาถ่ายใหม่')).status).toBe(200);

    const { socket, room, message } = await shopOpensAndSays(app, w, 'ต้องใช้เอกสารแบบไหนครับ');
    socket.disconnect();
    const a = await connected(app, w.adminA);
    const reply = await emitAck(a, 'sendShopAdminMessage', { roomId: room.id, content: 'ใช้สำเนาบัตรประชาชนที่ถ่ายชัดครับ' });
    a.disconnect();

    expect(message.senderSide).toBe('SHOP');
    expect(reply.ok).toBe(true);
  });

  it('refuses to open a first room for a shop its owner closed — there is nothing to read', async () => {
    const app = getApp();
    const w = await world(app);
    expect((await post(w.seller, `/shops/${w.shopId}/close`)).status).toBe(200);

    const a = await connected(app, w.adminA);
    const opened = await emitAck(a, 'openShopAdminRoom', { shopId: w.shopId });
    a.disconnect();

    expect(opened).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('lets a suspended shop ask for a review', async () => {
    const app = getApp();
    const w = await world(app);
    await suspendShop(app, w.shopId);
    const { socket, message } = await shopOpensAndSays(app, w, 'ขอทบทวนการระงับร้านครับ');
    socket.disconnect();

    expect(message.senderSide).toBe('SHOP');
  });

  it('keeps a closed shop’s room readable but refuses a new message from either side', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room, message } = await shopOpensAndSays(app, w, 'ก่อนปิดร้าน');
    expect((await post(w.seller, `/shops/${w.shopId}/close`)).status).toBe(200);

    const history = await emitAck<Page<MessageBody>>(socket, 'listShopAdminMessages', { roomId: room.id });
    const fromShop = await emitAck(socket, 'sendShopAdminMessage', { roomId: room.id, content: 'หลังปิดร้าน' });
    // Read-only means every write: an edit, an unsend (still inside its 15 minutes) and an upload too.
    const edit = await emitAck(socket, 'editShopAdminMessage', { roomId: room.id, messageId: message.id, content: 'แก้หลังปิดร้าน' });
    const unsend = await emitAck(socket, 'unsendShopAdminMessage', { roomId: room.id, messageId: message.id });
    socket.disconnect();
    const upload = await w.seller
      .post(`${API}/shop-admin-chat-rooms/${room.id}/attachments`)
      .set(CSRF_HEADER, await csrfToken(w.seller))
      .attach('file', await aJpeg(), 'late.jpg');
    expect(edit).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(unsend).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(upload.status).toBe(409);
    const a = await connected(app, w.adminA);
    const fromAdmin = await emitAck(a, 'sendShopAdminMessage', { roomId: room.id, content: 'แอดมินหลังร้านปิด' });
    a.disconnect();

    expect(history.ok).toBe(true);
    expect(fromShop).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(fromAdmin).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
});

describe('pictures, limits and sides (§106)', () => {
  it('hides an unsent picture from the shop and keeps it for the admins', async () => {
    const app = getApp();
    const w = await world(app);
    const socket = await connected(app, w.seller);
    const room = dataOf(await emitAck<RoomBody>(socket, 'openShopAdminRoom', { shopId: w.shopId }));
    const uploaded = await w.seller.post(`${API}/shop-admin-chat-rooms/${room.id}/attachments`).set(CSRF_HEADER, await csrfToken(w.seller)).attach('file', await aJpeg(), 'wrong.jpg');
    const fileId = (uploaded.body as { fileId: string }).fileId;
    const sent = dataOf(await emitAck<MessageBody>(socket, 'sendShopAdminMessage', { roomId: room.id, fileId }));
    expect((await emitAck(socket, 'unsendShopAdminMessage', { roomId: room.id, messageId: sent.id })).ok).toBe(true);
    socket.disconnect();

    expect((await w.seller.get(`${API}/shop-admin-chat-rooms/${room.id}/attachments/${fileId}`)).status).toBe(404);
    expect((await w.adminA.get(`${API}/shop-admin-chat-rooms/${room.id}/attachments/${fileId}`)).status).toBe(200);
  });

  it('refuses a message over 2000 characters', async () => {
    const app = getApp();
    const w = await world(app);
    const socket = await connected(app, w.seller);
    const room = dataOf(await emitAck<RoomBody>(socket, 'openShopAdminRoom', { shopId: w.shopId }));
    const tooLong = await emitAck(socket, 'sendShopAdminMessage', { roomId: room.id, content: 'ก'.repeat(2001) });
    socket.disconnect();

    expect(tooLong).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('keeps the owner on the shop’s side of their own shop’s room, even once they are an admin of that community (N28)', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room } = await shopOpensAndSays(app, w, 'ก่อนเป็นแอดมิน');
    socket.disconnect();
    // A person with an open shop cannot be appointed (N29), so the shop closes first.
    expect((await post(w.seller, `/shops/${w.shopId}/close`)).status).toBe(200);
    expect((await post(w.superAdmin, `/communities/${w.communityA}/admins`, { userId: w.sellerId })).status).toBe(201);

    const again = await connected(app, w.seller);
    const joined = dataOf(await emitAck<RoomBody>(again, 'joinShopAdminRoom', { roomId: room.id }));
    again.disconnect();

    expect(joined.side).toBe('SHOP');
  });

  it('discards a picture uploaded and never sent after 24 hours (the one sweep)', async () => {
    const app = getApp();
    const w = await world(app);
    const socket = await connected(app, w.seller);
    const room = dataOf(await emitAck<RoomBody>(socket, 'openShopAdminRoom', { shopId: w.shopId }));
    socket.disconnect();
    const uploaded = await w.seller.post(`${API}/shop-admin-chat-rooms/${room.id}/attachments`).set(CSRF_HEADER, await csrfToken(w.seller)).attach('file', await aJpeg(), 'never-sent.jpg');
    const fileId = (uploaded.body as { fileId: string }).fileId;

    app.clock.advanceByHours(25);
    await app.sweep.run();

    // Read-only checks through Prisma, as the buyer chat's own sweep test does: an unsent upload
    // has no route that could show it is gone.
    expect(await app.prisma.shopAdminChatPendingAttachment.count()).toBe(0);
    expect(await app.prisma.uploadedFile.findUnique({ where: { id: fileId } })).toBeNull();
  });
});

describe('a PDPA erasure overwrites the shop owner’s side of the conversation (§106 · G3/H8)', () => {
  it('replaces the owner’s messages and their earlier versions, and keeps what the admins wrote', async () => {
    const app = getApp();
    const w = await world(app);
    const { socket, room, message } = await shopOpensAndSays(app, w, 'ติดต่อผมที่ 0812345678');
    await emitAck(socket, 'editShopAdminMessage', { roomId: room.id, messageId: message.id, content: 'ติดต่อผมทางแชทนี้ได้เลย' });
    const picture = await w.seller.post(`${API}/shop-admin-chat-rooms/${room.id}/attachments`).set(CSRF_HEADER, await csrfToken(w.seller)).attach('file', await aJpeg(), 'id-card.jpg');
    const pictureId = (picture.body as { fileId: string }).fileId;
    await emitAck(socket, 'sendShopAdminMessage', { roomId: room.id, fileId: pictureId });
    socket.disconnect();
    const a = await connected(app, w.adminA);
    await emitAck(a, 'sendShopAdminMessage', { roomId: room.id, content: 'รับทราบครับ' });

    // A shop owner closes the shop before asking for erasure (existing rule); the room stays readable.
    expect((await post(w.seller, `/shops/${w.shopId}/close`)).status).toBe(200);
    const erased = await post(w.seller, '/auth/account/erase');
    expect(erased.status).toBe(204);

    const history = dataOf(await emitAck<Page<MessageBody>>(a, 'listShopAdminMessages', { roomId: room.id }));
    const versions = dataOf(await emitAck<Page<{ content: string }>>(a, 'listShopAdminMessageVersions', { roomId: room.id, messageId: message.id }));
    a.disconnect();

    expect(history.items.find((m) => m.senderSide === 'SHOP')?.content).toBe(ERASED_CHAT_MESSAGE_PLACEHOLDER);
    expect(history.items.find((m) => m.senderSide === 'ADMIN')?.content).toBe('รับทราบครับ');
    expect(versions.items.map((v) => v.content).join(' ')).not.toContain('0812345678');
    // The picture they sent: the message still names it, the bytes are gone (K1).
    expect((await w.adminA.get(`${API}/shop-admin-chat-rooms/${room.id}/attachments/${pictureId}`)).status).toBe(404);
  });
});

describe('§113 — an erased owner is not given new notices', () => {
  it('an admin answering a rejected shop whose owner has since been erased writes no notice for the erased account', async () => {
    const app = getApp();
    const w = await world(app, { approve: false });
    expect((await rejectShopAs(w.superAdmin, w.shopId, 'เอกสารยืนยันตัวตนไม่ชัดเจน กรุณาถ่ายใหม่')).status).toBe(200);
    const { socket, room } = await shopOpensAndSays(app, w, 'ต้องใช้เอกสารแบบไหนครับ');
    socket.disconnect();
    expect((await w.seller.post(`${API}/auth/account/erase`).set(CSRF_HEADER, await csrfToken(w.seller))).status).toBe(204);

    const a = await connected(app, w.adminA);
    const reply = await emitAck(a, 'sendShopAdminMessage', { roomId: room.id, content: 'ใช้สำเนาบัตรประชาชนที่ถ่ายชัดครับ' });
    a.disconnect();

    expect(reply.ok).toBe(true);
    expect(await app.prisma.notification.count({ where: { userId: w.sellerId } })).toBe(0);
  });
});
