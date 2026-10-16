import sharp from 'sharp';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { CHAT_UNSEND_WINDOW_MINUTES } from '../src/chat/chat-policy.js';
import { MAX_CHAT_MESSAGE_LENGTH } from '../src/chat/dto/send-message.dto.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * §89 — editing and unsending a chat message the way Messenger does (the project owner's choice):
 * the sender edits the *text* of their own message with no time limit, and both parties can open
 * every earlier version; the sender may unsend within `CHAT_UNSEND_WINDOW_MINUTES`, after which
 * both parties see only that it was unsent. Nothing is ever lost — the chat is dispute evidence
 * (H8) — so the original of an unsent message stays for an admin under an open dispute
 * (`chat-admin.spec.ts`), and erasure overwrites every version (`account-erasure.spec.ts`).
 *
 * Seam 1 over the real socket, seam 2's `clock` for the unsend window and "no time limit".
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const STRANGER = 'stranger@example.test';

interface MessageBody {
  id: string;
  roomId: string;
  senderId: string;
  orderId: string | null;
  fileId: string | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  unsentAt: string | null;
}
interface VersionBody {
  id: string;
  content: string;
  writtenAt: string;
}
interface PageBody<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}
type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };

const openSockets: ClientSocket[] = [];

afterEach(() => {
  for (const socket of openSockets) {
    socket.disconnect();
  }
  openSockets.length = 0;
});

async function connected(app: TestApp, client: Agent): Promise<ClientSocket> {
  const socket = chatSocket(app, client);
  openSockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error: Error) => reject(error));
    socket.connect();
  });

  return socket;
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: AckResponse<T>) => resolve(response));
  });
}

/**
 * The first `messageUpdated` push matching `accept`. A push from an earlier step can still be in
 * flight when the next step starts — the ack reaches the sender before the broadcast reaches the
 * other party — so a bare `once` could catch the wrong one.
 */
function nextUpdate(socket: ClientSocket, accept: (message: MessageBody) => boolean = () => true): Promise<MessageBody> {
  return new Promise((resolve) => {
    const listener = (data: MessageBody) => {
      if (accept(data)) {
        socket.off('messageUpdated', listener);
        resolve(data);
      }
    };
    socket.on('messageUpdated', listener);
  });
}

function data<T>(response: AckResponse<T>): T {
  if (!response.ok) {
    throw new Error(`expected ok, got ${response.error.code}: ${response.error.message}`);
  }
  return response.data;
}

function errorOf<T>(response: AckResponse<T>): ErrorBody {
  if (response.ok) {
    throw new Error('expected an error ack');
  }
  return response.error;
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 200 } } }).jpeg().toBuffer();
}

/** One approved shop, a buyer, and the room between them, both parties connected and joined. */
async function roomScenario(app: TestApp): Promise<{ buyer: Agent; seller: Agent; buyerSocket: ClientSocket; sellerSocket: ClientSocket; roomId: string }> {
  const superAdmin = app.client;
  await registerAndLogin(superAdmin, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
  const community = await superAdmin
    .post(`${API}/communities`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name: 'ชุมชนทดสอบแก้ข้อความ', description: 'รายละเอียดสำหรับทดสอบ' });
  const communityId = (community.body as { id: string }).id;

  const seller = newClient(app);
  await registerVerified(app, seller, SELLER);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบแก้ข้อความ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);

  const buyerSocket = await connected(app, buyer);
  const room = data(await emitAck<{ id: string }>(buyerSocket, 'openRoomWithShop', { shopId }));
  const sellerSocket = await connected(app, seller);
  data(await emitAck(sellerSocket, 'joinRoom', { roomId: room.id }));

  return { buyer, seller, buyerSocket, sellerSocket, roomId: room.id };
}

/**
 * Access tokens live 15 minutes (I17) and a socket carries the one it connected with, so a test that
 * moves the clock past that signs in again and reconnects — as a real client's refresh would.
 */
async function reconnectAfterClockJump(app: TestApp, client: Agent, email: string): Promise<ClientSocket> {
  await login(client, email);
  return connected(app, client);
}

async function send(socket: ClientSocket, roomId: string, content: string, fileId?: string): Promise<MessageBody> {
  return data(await emitAck<MessageBody>(socket, 'sendMessage', { roomId, content, ...(fileId !== undefined ? { fileId } : {}) }));
}

function edit(socket: ClientSocket, roomId: string, messageId: string, content: unknown) {
  return emitAck<MessageBody>(socket, 'editMessage', { roomId, messageId, content });
}

function unsend(socket: ClientSocket, roomId: string, messageId: string) {
  return emitAck<MessageBody>(socket, 'unsendMessage', { roomId, messageId });
}

function versions(socket: ClientSocket, roomId: string, messageId: string, extra: Record<string, unknown> = {}) {
  return emitAck<PageBody<VersionBody>>(socket, 'listMessageVersions', { roomId, messageId, ...extra });
}

async function history(socket: ClientSocket, roomId: string): Promise<MessageBody[]> {
  return data(await emitAck<PageBody<MessageBody>>(socket, 'listMessages', { roomId })).items;
}

async function uploadPicture(client: Agent, roomId: string): Promise<string> {
  const response = await client
    .post(`${API}/chat-rooms/${roomId}/attachments`)
    .set(CSRF_HEADER, await csrfToken(client))
    .attach('file', await aJpegBuffer(), 'chat.jpg');

  return (response.body as { fileId: string }).fileId;
}

describe('§89 — editing a message: text only, no time limit, every version visible to both parties', () => {
  it('the sender edits their own message; the other party is pushed the update and reads the new text, marked edited', async () => {
    const app = getApp();
    const { buyerSocket, sellerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ขอสั่ง 2 ชิ้นครับ');
    expect(sent.editedAt).toBeNull();
    expect(sent.unsentAt).toBeNull();

    const pushed = nextUpdate(sellerSocket);
    const edited = data(await edit(buyerSocket, roomId, sent.id, 'ขอสั่ง 3 ชิ้นครับ'));

    expect(edited.id).toBe(sent.id);
    expect(edited.content).toBe('ขอสั่ง 3 ชิ้นครับ');
    expect(edited.editedAt).not.toBeNull();
    expect(edited.createdAt).toBe(sent.createdAt); // an edit never moves the message in the conversation
    expect((await pushed).content).toBe('ขอสั่ง 3 ชิ้นครับ');
    const [latest] = await history(sellerSocket, roomId);
    expect(latest?.content).toBe('ขอสั่ง 3 ชิ้นครับ');
    expect(latest?.editedAt).toBe(edited.editedAt);
  });

  it('both parties read every version, newest first, the original included with when it was written', async () => {
    const app = getApp();
    const { buyerSocket, sellerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ราคา 100 บาทใช่ไหมครับ');
    app.clock.advanceByMinutes(2);
    data(await edit(buyerSocket, roomId, sent.id, 'ราคา 150 บาทใช่ไหมครับ'));
    app.clock.advanceByMinutes(3);
    const last = data(await edit(buyerSocket, roomId, sent.id, 'ราคา 200 บาทใช่ไหมครับ'));

    for (const socket of [buyerSocket, sellerSocket]) {
      const page = data(await versions(socket, roomId, sent.id));
      expect(page.items.map((v) => v.content)).toEqual(['ราคา 200 บาทใช่ไหมครับ', 'ราคา 150 บาทใช่ไหมครับ', 'ราคา 100 บาทใช่ไหมครับ']);
      expect(page.items[0]?.writtenAt).toBe(last.editedAt);
      expect(page.items[2]?.writtenAt).toBe(sent.createdAt);
    }
  });

  it('a message never edited has exactly one version — the one it was sent with', async () => {
    const app = getApp();
    const { buyerSocket, sellerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'สวัสดีครับ');

    const page = data(await versions(sellerSocket, roomId, sent.id));

    expect(page.items).toEqual([expect.objectContaining({ content: 'สวัสดีครับ', writtenAt: sent.createdAt })]);
  });

  it('there is no time limit on editing (the owner’s choice) — a month later still works', async () => {
    const app = getApp();
    const { buyer, buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ส่งพรุ่งนี้นะครับ');
    app.clock.advanceByDays(30);
    const later = await reconnectAfterClockJump(app, buyer, BUYER);

    const edited = await edit(later, roomId, sent.id, 'ส่งมะรืนนะครับ');

    expect(data(edited).content).toBe('ส่งมะรืนนะครับ');
  });

  it('only the sender may edit: the other party and a stranger both get NOT_FOUND, and nothing changes', async () => {
    const app = getApp();
    const { sellerSocket, buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ของยังมีไหมครับ');
    const stranger = newClient(app);
    await registerVerified(app, stranger, STRANGER);
    const strangerSocket = await connected(app, stranger);

    expect(errorOf(await edit(sellerSocket, roomId, sent.id, 'แก้แทนผู้ซื้อ')).code).toBe('NOT_FOUND');
    expect(errorOf(await edit(strangerSocket, roomId, sent.id, 'แก้จากคนนอก')).code).toBe('NOT_FOUND');
    expect(errorOf(await versions(strangerSocket, roomId, sent.id)).code).toBe('NOT_FOUND');
    const [unchanged] = await history(sellerSocket, roomId);
    expect(unchanged?.content).toBe('ของยังมีไหมครับ');
    expect(unchanged?.editedAt).toBeNull();
  });

  it('a message id from another room is NOT_FOUND, even for its own sender', async () => {
    const app = getApp();
    const { buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ข้อความในห้องจริง');

    const wrongRoom = await edit(buyerSocket, '0190a000-0000-7000-8000-000000000000', sent.id, 'ย้ายห้อง');

    expect(errorOf(wrongRoom).code).toBe('NOT_FOUND');
  });

  it('a text-only message cannot be edited to nothing, nor past the length limit', async () => {
    const app = getApp();
    const { buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ข้อความเดิม');

    expect(errorOf(await edit(buyerSocket, roomId, sent.id, '   ')).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await edit(buyerSocket, roomId, sent.id, 'ก'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1))).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await edit(buyerSocket, roomId, sent.id, 42)).code).toBe('VALIDATION_FAILED');
  });

  it('a picture message: the caption can be edited (even cleared), the picture itself cannot be swapped', async () => {
    const app = getApp();
    const { buyer, buyerSocket, sellerSocket, roomId } = await roomScenario(app);
    const picture = await uploadPicture(buyer, roomId);
    const sent = await send(buyerSocket, roomId, 'รูปสินค้าที่ได้รับ', picture);
    const another = await uploadPicture(buyer, roomId);

    const swap = await emitAck<MessageBody>(buyerSocket, 'editMessage', { roomId, messageId: sent.id, content: 'รูปใหม่', fileId: another });
    expect(errorOf(swap).code).toBe('VALIDATION_FAILED'); // `fileId` is not an editable field

    const cleared = data(await edit(buyerSocket, roomId, sent.id, ''));
    expect(cleared.content).toBe('');
    expect(cleared.fileId).toBe(picture);
    const [latest] = await history(sellerSocket, roomId);
    expect(latest?.fileId).toBe(picture);
  });

  it('saving the same text again is not an edit — no "edited" mark, no new version', async () => {
    const app = getApp();
    const { buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ขอบคุณครับ');

    const same = data(await edit(buyerSocket, roomId, sent.id, '  ขอบคุณครับ  '));

    expect(same.editedAt).toBeNull();
    expect(data(await versions(buyerSocket, roomId, sent.id)).items).toHaveLength(1);
  });

  it('§91 review: saving the same text pushes nothing to the room — the next push the other party gets is the real edit', async () => {
    const app = getApp();
    const { buyerSocket, sellerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ขอบคุณครับ');
    const firstPush = nextUpdate(sellerSocket);

    data(await edit(buyerSocket, roomId, sent.id, 'ขอบคุณครับ'));
    data(await edit(buyerSocket, roomId, sent.id, 'ขอบคุณมากครับ'));

    expect((await firstPush).content).toBe('ขอบคุณมากครับ');
  });

  it('edits count against the same 30-a-minute ceiling as sending (L7), so a version history cannot be flooded', async () => {
    const app = getApp();
    const { buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'รุ่นที่ 0');

    for (let i = 1; i < 30; i++) {
      data(await edit(buyerSocket, roomId, sent.id, `รุ่นที่ ${String(i)}`));
    }
    const overTheLimit = await edit(buyerSocket, roomId, sent.id, 'รุ่นที่ 30');

    expect(errorOf(overTheLimit).code).toBe('RATE_LIMITED');
  });

  it('versions are paged like every other list — `limit` and `nextCursor`', async () => {
    const app = getApp();
    const { buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'รุ่นแรก');
    data(await edit(buyerSocket, roomId, sent.id, 'รุ่นสอง'));
    data(await edit(buyerSocket, roomId, sent.id, 'รุ่นสาม'));

    const first = data(await versions(buyerSocket, roomId, sent.id, { limit: 2 }));
    const second = data(await versions(buyerSocket, roomId, sent.id, { limit: 2, cursor: first.nextCursor }));

    expect(first.items.map((v) => v.content)).toEqual(['รุ่นสาม', 'รุ่นสอง']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((v) => v.content)).toEqual(['รุ่นแรก']);
    expect(second.hasMore).toBe(false);
  });
});

describe(`§89 — unsending a message: the sender only, within ${String(CHAT_UNSEND_WINDOW_MINUTES)} minutes`, () => {
  it('both parties then see only that it was unsent — no text, no picture, no versions — and the other party is pushed it', async () => {
    const app = getApp();
    const { buyer, seller, buyerSocket, sellerSocket, roomId } = await roomScenario(app);
    const picture = await uploadPicture(buyer, roomId);
    const sent = await send(buyerSocket, roomId, 'โอนไปที่บัญชีนี้นะ 123-4-56789-0', picture);
    data(await edit(buyerSocket, roomId, sent.id, 'โอนไปที่บัญชีนี้นะ 999-9-99999-9'));
    app.clock.advanceByMinutes(CHAT_UNSEND_WINDOW_MINUTES - 1);

    const pushed = nextUpdate(sellerSocket, (message) => message.unsentAt !== null);
    const unsent = data(await unsend(buyerSocket, roomId, sent.id));

    expect(unsent.unsentAt).not.toBeNull();
    expect(unsent.content).toBe('');
    expect(unsent.fileId).toBeNull();
    expect((await pushed).unsentAt).toBe(unsent.unsentAt);
    for (const socket of [buyerSocket, sellerSocket]) {
      const [latest] = await history(socket, roomId);
      expect(latest).toMatchObject({ id: sent.id, content: '', fileId: null, unsentAt: unsent.unsentAt });
      expect(errorOf(await versions(socket, roomId, sent.id)).code).toBe('NOT_FOUND');
    }
    for (const client of [buyer, seller]) {
      expect((await client.get(`${API}/chat-rooms/${roomId}/attachments/${picture}`)).status).toBe(404);
    }
  });

  it(`is refused once ${String(CHAT_UNSEND_WINDOW_MINUTES)} minutes have passed — the message stays exactly as it was`, async () => {
    const app = getApp();
    const { buyer, seller, buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ตกลงซื้อครับ');
    app.clock.advanceByMinutes(CHAT_UNSEND_WINDOW_MINUTES);
    app.clock.advanceBy(1);
    const later = await reconnectAfterClockJump(app, buyer, BUYER);

    const late = await unsend(later, roomId, sent.id);

    expect(errorOf(late).code).toBe('CONFLICT');
    const [latest] = await history(await reconnectAfterClockJump(app, seller, SELLER), roomId);
    expect(latest).toMatchObject({ content: 'ตกลงซื้อครับ', unsentAt: null });
  });

  it('only the sender may unsend', async () => {
    const app = getApp();
    const { buyerSocket, sellerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ข้อความของผู้ซื้อ');

    expect(errorOf(await unsend(sellerSocket, roomId, sent.id)).code).toBe('NOT_FOUND');
  });

  it('an unsent message can be neither edited nor unsent again', async () => {
    const app = getApp();
    const { buyerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'พิมพ์ผิดห้อง');
    data(await unsend(buyerSocket, roomId, sent.id));

    expect(errorOf(await edit(buyerSocket, roomId, sent.id, 'กลับมาแก้')).code).toBe('CONFLICT');
    expect(errorOf(await unsend(buyerSocket, roomId, sent.id)).code).toBe('CONFLICT');
  });

  it('the room list shows an unsent last message as unsent, not its text', async () => {
    const app = getApp();
    const { buyerSocket, sellerSocket, roomId } = await roomScenario(app);
    const sent = await send(buyerSocket, roomId, 'ข้อความที่จะยกเลิก');
    data(await unsend(buyerSocket, roomId, sent.id));

    const rooms = data(await emitAck<PageBody<{ id: string; lastMessage: MessageBody | null }>>(sellerSocket, 'listRooms', {}));

    expect(rooms.items[0]?.lastMessage).toMatchObject({ id: sent.id, content: '', unsentAt: expect.any(String) as unknown });
  });
});
