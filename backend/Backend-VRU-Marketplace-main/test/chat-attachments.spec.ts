import sharp from 'sharp';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { MAX_CHAT_MESSAGE_LENGTH } from '../src/chat/dto/send-message.dto.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #67 (K17 · L7): image attachments, the per-room unread count, and the message length/rate
 * ceilings — everything #66 deliberately left out. Room and message mechanics themselves are
 * `test/chat-rooms.spec.ts`'s job; this file only covers what #67 actually added.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'other-buyer@example.test';

interface RoomBody {
  id: string;
}
interface MessageBody {
  id: string;
  roomId: string;
  fileId: string | null;
  content: string;
}
interface RoomSummaryBody {
  id: string;
  unreadCount: number;
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

async function sellerWithShop(app: TestApp, email: string, communityId: string): Promise<{ seller: Agent; shopId: string }> {
  const seller = newClient(app);
  await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return { seller, shopId };
}

async function scenario(app: TestApp): Promise<{ buyer: Agent; seller: Agent; shopId: string }> {
  const superAdmin = newClient(app);
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนทดสอบไฟล์แนบแชท');
  const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);

  return { buyer, seller, shopId };
}

async function aJpegBuffer(withExif = false): Promise<Buffer> {
  const image = sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } } });

  if (withExif) {
    return image.withExif({ IFD0: { Make: 'TestPhoneCo', GPSLatitude: '13.75' } }).jpeg().toBuffer();
  }

  return image.jpeg().toBuffer();
}

async function uploadAttachment(client: Agent, roomId: string, buffer: Buffer, filename = 'photo.jpg') {
  return client
    .post(`${API}/chat-rooms/${roomId}/attachments`)
    .set(CSRF_HEADER, await csrfToken(client))
    .attach('file', buffer, filename);
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

async function openedRoomId(app: TestApp, buyer: Agent, shopId: string): Promise<{ roomId: string; buyerSocket: ClientSocket }> {
  const socket = chatSocket(app, buyer);
  await connect(socket);
  const opened = await emitAck<RoomBody>(socket, 'openRoomWithShop', { shopId });
  if (!opened.ok) {
    throw new Error(`openRoomWithShop failed: ${JSON.stringify(opened)}`);
  }

  return { roomId: opened.data.id, buyerSocket: socket };
}

describe('#67 (K17 · E1): image attachments', () => {
  it('a picture needs no caption — empty content with a fileId is accepted', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);

    const uploaded = await uploadAttachment(buyer, roomId, await aJpegBuffer());
    expect(uploaded.status).toBe(201);
    const { fileId } = uploaded.body as { fileId: string };

    const sent = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, fileId });

    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.data.fileId).toBe(fileId);
      expect(sent.data.content).toBe('');
    }
  });

  it('strips EXIF (GPS) from an attachment on upload', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId } = await openedRoomId(app, buyer, shopId);

    const jpegWithExif = await aJpegBuffer(true);
    const sourceMetadata = await sharp(jpegWithExif).metadata();
    expect(sourceMetadata.exif).toBeDefined();

    const uploaded = await uploadAttachment(buyer, roomId, jpegWithExif);
    const { fileId } = uploaded.body as { fileId: string };
    // Attach it to a real message — the read route only serves files a message actually names.
    const buyerSocket = chatSocket(app, buyer);
    await connect(buyerSocket);
    await emitAck(buyerSocket, 'joinRoom', { roomId });
    await emitAck(buyerSocket, 'sendMessage', { roomId, fileId, content: 'รูปมี EXIF' });

    const read = await buyer.get(`${API}/chat-rooms/${roomId}/attachments/${fileId}`);
    const storedMetadata = await sharp(read.body as Buffer).metadata();

    expect(storedMetadata.exif).toBeUndefined();
  });

  it('rejects a file that is not really a jpg/png, even named like one — pdf included (E1)', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId } = await openedRoomId(app, buyer, shopId);

    const response = await uploadAttachment(buyer, roomId, Buffer.from('%PDF-1.4 not a real pdf either'), 'slip.pdf');

    expect(response.status).toBe(400);
  });

  it('a non-participant cannot read an attachment, even knowing its id', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);
    const uploaded = await uploadAttachment(buyer, roomId, await aJpegBuffer());
    const { fileId } = uploaded.body as { fileId: string };
    await emitAck(buyerSocket, 'sendMessage', { roomId, fileId, content: 'ดูรูปนี้สิ' });

    const outsider = newClient(app);
    await registerVerified(app, outsider, OTHER_BUYER);

    const response = await outsider.get(`${API}/chat-rooms/${roomId}/attachments/${fileId}`);

    expect(response.status).toBe(404);
  });

  it('an uploaded file nobody ever sent is not readable, even by its own uploader', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId } = await openedRoomId(app, buyer, shopId);
    const uploaded = await uploadAttachment(buyer, roomId, await aJpegBuffer());
    const { fileId } = uploaded.body as { fileId: string };

    const response = await buyer.get(`${API}/chat-rooms/${roomId}/attachments/${fileId}`);

    expect(response.status).toBe(404);
  });

  it('a message with neither text nor an attachment is rejected', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);

    const sent = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId });

    expect(sent.ok).toBe(false);
    if (!sent.ok) {
      expect(sent.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('uploading to a room the caller is not a party of is refused', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId } = await openedRoomId(app, buyer, shopId);

    const outsider = newClient(app);
    await registerVerified(app, outsider, OTHER_BUYER);

    const response = await uploadAttachment(outsider, roomId, await aJpegBuffer());

    expect(response.status).toBe(404);
  });
});

describe('#67 (K17): unread count', () => {
  it('the other party sees an unread count; reading history clears it back to zero', async () => {
    const app = getApp();
    const { buyer, seller, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);

    await emitAck(buyerSocket, 'sendMessage', { roomId, content: 'ข้อความที่หนึ่ง' });
    await emitAck(buyerSocket, 'sendMessage', { roomId, content: 'ข้อความที่สอง' });

    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);
    await emitAck(sellerSocket, 'joinRoom', { roomId });

    const beforeRead = await emitAck<{ items: RoomSummaryBody[] }>(sellerSocket, 'listRooms', {});
    expect(beforeRead.ok).toBe(true);
    if (beforeRead.ok) {
      expect(beforeRead.data.items.find((r) => r.id === roomId)?.unreadCount).toBe(2);
    }

    await emitAck(sellerSocket, 'listMessages', { roomId });

    const afterRead = await emitAck<{ items: RoomSummaryBody[] }>(sellerSocket, 'listRooms', {});
    expect(afterRead.ok).toBe(true);
    if (afterRead.ok) {
      expect(afterRead.data.items.find((r) => r.id === roomId)?.unreadCount).toBe(0);
    }
  });

  it('a caller’s own messages are never counted as their own unread', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);

    await emitAck(buyerSocket, 'sendMessage', { roomId, content: 'ข้อความของตัวเอง' });

    const rooms = await emitAck<{ items: RoomSummaryBody[] }>(buyerSocket, 'listRooms', {});

    expect(rooms.ok).toBe(true);
    if (rooms.ok) {
      expect(rooms.data.items.find((r) => r.id === roomId)?.unreadCount).toBe(0);
    }
  });
});

describe('#67 (L7): message length and rate limit', () => {
  it('a message over the length ceiling is rejected', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);

    const tooLong = 'ก'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1);
    const sent = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: tooLong });

    expect(sent.ok).toBe(false);
    if (!sent.ok) {
      expect(sent.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('exceeding the per-sender rate limit is refused with RATE_LIMITED, not a dropped connection', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);

    let lastResponse: AckResponse<MessageBody> | undefined;
    for (let i = 0; i < 31; i += 1) {
      lastResponse = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: `ข้อความที่ ${String(i)}` });
    }

    expect(lastResponse?.ok).toBe(false);
    if (lastResponse && !lastResponse.ok) {
      expect(lastResponse.error.code).toBe('RATE_LIMITED');
    }
    expect(buyerSocket.connected).toBe(true);
  });

  it('the rate-limit window reopens (seam 2)', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);

    for (let i = 0; i < 30; i += 1) {
      await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: `ข้อความที่ ${String(i)}` });
    }
    const blocked = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: 'เกินโควตา' });
    expect(blocked.ok).toBe(false);

    app.clock.advanceByMinutes(1);

    const afterWindow = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: 'หน้าต่างใหม่แล้ว' });
    expect(afterWindow.ok).toBe(true);
  });
});

describe('code review of topic 11 (§83)', () => {
  it('🚨 a fileId someone else uploaded cannot be attached — only the sender’s own, unsent upload in this room', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);
    const other = await openedRoomId(app, otherBuyer, shopId);
    const othersUpload = await uploadAttachment(otherBuyer, other.roomId, await aJpegBuffer());
    const othersFileId = (othersUpload.body as { fileId: string }).fileId;

    const sent = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, fileId: othersFileId });

    expect(sent.ok).toBe(false);
    if (!sent.ok) {
      expect(sent.error.code).toBe('VALIDATION_FAILED');
      expect(sent.error.fieldErrors?.fileId).toMatch(/[\u0E00-\u0E7F]/);
    }
    const read = await buyer.get(`${API}/chat-rooms/${roomId}/attachments/${othersFileId}`);
    expect(read.status).toBe(404);
  });

  it('one upload attaches to one message — sending the same fileId twice is refused', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);
    const { fileId } = (await uploadAttachment(buyer, roomId, await aJpegBuffer())).body as { fileId: string };

    const first = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, fileId });
    const second = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, fileId });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('🚨 at most five unsent uploads per person per room — the sixth is refused until one is sent', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);

    const fileIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const uploaded = await uploadAttachment(buyer, roomId, await aJpegBuffer());
      expect(uploaded.status).toBe(201);
      fileIds.push((uploaded.body as { fileId: string }).fileId);
    }
    const filesBefore = await app.prisma.uploadedFile.count();

    const sixth = await uploadAttachment(buyer, roomId, await aJpegBuffer());
    expect(sixth.status).toBe(409);
    expect((sixth.body as ErrorBody).code).toBe('CONFLICT');
    expect(await app.prisma.uploadedFile.count()).toBe(filesBefore);

    await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, fileId: fileIds[0] });
    expect((await uploadAttachment(buyer, roomId, await aJpegBuffer())).status).toBe(201);
  });

  it('🚨 an upload never sent is deleted by the sweep after 24 hours — a sent one is untouched (seam 2)', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);
    const sentFile = ((await uploadAttachment(buyer, roomId, await aJpegBuffer())).body as { fileId: string }).fileId;
    await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, fileId: sentFile });
    const abandoned = ((await uploadAttachment(buyer, roomId, await aJpegBuffer())).body as { fileId: string }).fileId;

    app.clock.advanceByHours(23);
    await app.sweep.run();
    expect(await app.prisma.uploadedFile.findUnique({ where: { id: abandoned } })).not.toBeNull();

    app.clock.advanceByHours(2);
    await app.sweep.run();

    expect(await app.prisma.uploadedFile.findUnique({ where: { id: abandoned } })).toBeNull();
    // A day later the access token is long expired — sign in again so what is refused below is
    // refused for the file, not for the session.
    await login(buyer, BUYER);
    const freshSocket = chatSocket(app, buyer);
    await connect(freshSocket);
    const late = await emitAck<MessageBody>(freshSocket, 'sendMessage', { roomId, fileId: abandoned });
    expect(late.ok).toBe(false);
    if (!late.ok) {
      expect(late.error.fieldErrors?.fileId).toBeDefined();
    }
    const stillThere = await buyer.get(`${API}/chat-rooms/${roomId}/attachments/${sentFile}`);
    expect(stillThere.status).toBe(200);
  });

  it('an attachment is served private and never cached, like a payment slip (§82)', async () => {
    const app = getApp();
    const { buyer, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);
    const { fileId } = (await uploadAttachment(buyer, roomId, await aJpegBuffer())).body as { fileId: string };
    await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, fileId });

    const read = await buyer.get(`${API}/chat-rooms/${roomId}/attachments/${fileId}`);

    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
  });

  it('🚨 one party hitting the rate limit does not silence the other party in the same room', async () => {
    const app = getApp();
    const { buyer, seller, shopId } = await scenario(app);
    const { roomId, buyerSocket } = await openedRoomId(app, buyer, shopId);
    const sellerSocket = chatSocket(app, seller);
    await connect(sellerSocket);

    for (let i = 0; i < 30; i += 1) {
      await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: `สแปมที่ ${String(i)}` });
    }
    const buyerBlocked = await emitAck<MessageBody>(buyerSocket, 'sendMessage', { roomId, content: 'เกินโควตา' });
    expect(buyerBlocked.ok).toBe(false);

    const sellerReply = await emitAck<MessageBody>(sellerSocket, 'sendMessage', { roomId, content: 'ร้านยังตอบได้' });
    expect(sellerReply.ok).toBe(true);
  });
});
