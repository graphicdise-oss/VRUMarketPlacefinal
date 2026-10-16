import type { Agent } from 'supertest';
import sharp from 'sharp';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #36: a shop owner's own payment channels (K5) and the file-storage helper they are the first
 * real user of (N1 · K1) — re-encoding to strip EXIF, content-sniffed type rather than trusting
 * the client, and an authenticated-only serving route (never a public one — L1).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';

interface ChannelBody {
  id: string;
  type: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  promptPayId: string | null;
  hasQrImage: boolean;
}

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

/** A seller with an APPROVED shop — payment channels always act on "my shop". */
async function sellerWithShop(app: TestApp, email: string): Promise<Agent> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, `ชุมชนของ ${email}`);

  const seller = newClient(app);
  await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  await approveShop(app, (applied.body as { id: string }).id);

  return seller;
}

const BANK_PAYLOAD = {
  type: 'BANK_TRANSFER',
  bankName: 'ธนาคารกรุงไทย',
  bankAccountNumber: '1234567890',
  bankAccountName: 'ร้านค้าทดสอบ',
};

const PROMPTPAY_PAYLOAD = { type: 'PROMPTPAY', promptPayId: '0812345678' };

async function create(client: Agent, payload: Record<string, unknown>) {
  return client
    .post(`${API}/shops/me/payment-channels`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send(payload);
}

async function update(client: Agent, id: string, payload: Record<string, unknown>) {
  return client
    .patch(`${API}/shops/me/payment-channels/${id}`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send(payload);
}

async function remove(client: Agent, id: string) {
  return client.delete(`${API}/shops/me/payment-channels/${id}`).set(CSRF_HEADER, await csrfToken(client)).send();
}

async function uploadQrImage(client: Agent, id: string, buffer: Buffer, filename = 'qr.jpg') {
  return client
    .post(`${API}/shops/me/payment-channels/${id}/qr-image`)
    .set(CSRF_HEADER, await csrfToken(client))
    .attach('file', buffer, filename);
}

async function aJpegBuffer(withExif = false): Promise<Buffer> {
  const image = sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } } });

  if (withExif) {
    return image.withExif({ IFD0: { Make: 'TestPhoneCo', GPSLatitude: '13.75' } }).jpeg().toBuffer();
  }

  return image.jpeg().toBuffer();
}

describe('a shop owner’s own payment channels (#36 · K5)', () => {
  it('requires a session', async () => {
    const response = await newClient(getApp()).get(`${API}/shops/me/payment-channels`);
    expect(response.status).toBe(401);
  });

  it('answers 404 for a caller with no shop', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, 'buyer@example.test');

    const response = await create(buyer, BANK_PAYLOAD);

    expect(response.status).toBe(404);
  });

  it('creates a bank-transfer channel', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);

    const response = await create(seller, BANK_PAYLOAD);

    expect(response.status).toBe(201);
    const body = response.body as ChannelBody;
    expect(body.type).toBe('BANK_TRANSFER');
    expect(body.bankAccountNumber).toBe('1234567890');
    expect(body.promptPayId).toBeNull();
    expect(body.hasQrImage).toBe(false);
  });

  it('creates a PromptPay channel', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);

    const response = await create(seller, PROMPTPAY_PAYLOAD);

    expect(response.status).toBe(201);
    const body = response.body as ChannelBody;
    expect(body.type).toBe('PROMPTPAY');
    expect(body.promptPayId).toBe('0812345678');
    expect(body.bankName).toBeNull();
  });

  it('rejects a bank-transfer channel missing its bank fields', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);

    const response = await create(seller, { type: 'BANK_TRANSFER' });

    expect(response.status).toBe(400);
  });

  it('rejects a PromptPay channel missing promptPayId', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);

    const response = await create(seller, { type: 'PROMPTPAY' });

    expect(response.status).toBe(400);
  });

  it('allows several channels on one shop', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);

    await create(seller, BANK_PAYLOAD);
    await create(seller, PROMPTPAY_PAYLOAD);
    const response = await seller.get(`${API}/shops/me/payment-channels`);

    expect(response.status).toBe(200);
    expect((response.body as ChannelBody[]).length).toBe(2);
  });

  it('lists only the caller’s own shop’s channels', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    await create(seller, BANK_PAYLOAD);

    const otherSeller = await sellerWithShop(app, OTHER_SELLER);
    const response = await otherSeller.get(`${API}/shops/me/payment-channels`);

    expect((response.body as ChannelBody[]).length).toBe(0);
  });

  it('edits a channel, clearing the other type’s fields on a type switch', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;

    const response = await update(seller, channelId, PROMPTPAY_PAYLOAD);

    expect(response.status).toBe(200);
    const body = response.body as ChannelBody;
    expect(body.type).toBe('PROMPTPAY');
    expect(body.promptPayId).toBe('0812345678');
    expect(body.bankName).toBeNull();
    expect(body.bankAccountNumber).toBeNull();
  });

  it('deletes a channel', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;

    const response = await remove(seller, channelId);
    expect(response.status).toBe(204);

    const list = await seller.get(`${API}/shops/me/payment-channels`);
    expect((list.body as ChannelBody[]).length).toBe(0);
  });

  it('answers 404 editing or deleting another shop’s channel', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;

    const otherSeller = await sellerWithShop(app, OTHER_SELLER);

    const editAttempt = await update(otherSeller, channelId, PROMPTPAY_PAYLOAD);
    const deleteAttempt = await remove(otherSeller, channelId);

    expect(editAttempt.status).toBe(404);
    expect(deleteAttempt.status).toBe(404);

    // Untouched.
    const stillMine = await seller.get(`${API}/shops/me/payment-channels`);
    expect((stillMine.body as ChannelBody[])[0]?.id).toBe(channelId);
  });
});

describe('the QR code photo on a payment channel (#36 · K1 · N1)', () => {
  it('uploads a real jpeg and serves it back with the right Content-Type', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;
    const jpeg = await aJpegBuffer();

    const uploadResponse = await uploadQrImage(seller, channelId, jpeg);
    expect(uploadResponse.status).toBe(200);
    expect((uploadResponse.body as ChannelBody).hasQrImage).toBe(true);

    const readResponse = await seller.get(`${API}/shops/me/payment-channels/${channelId}/qr-image`);
    expect(readResponse.status).toBe(200);
    expect(readResponse.headers['content-type']).toContain('image/jpeg');
    expect((readResponse.body as Buffer).length).toBeGreaterThan(0);
  });

  it('strips EXIF metadata on upload (GPS coordinates must not survive)', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;
    const jpegWithExif = await aJpegBuffer(true);
    // Prove the fixture actually carries EXIF, so the assertion below means something.
    const sourceMetadata = await sharp(jpegWithExif).metadata();
    expect(sourceMetadata.exif).toBeDefined();

    await uploadQrImage(seller, channelId, jpegWithExif);
    const readResponse = await seller.get(`${API}/shops/me/payment-channels/${channelId}/qr-image`);

    const storedMetadata = await sharp(readResponse.body as Buffer).metadata();
    expect(storedMetadata.exif).toBeUndefined();
  });

  it('rejects a file that is not really a jpeg/png, even named like one', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;

    const response = await uploadQrImage(seller, channelId, Buffer.from('not actually a jpeg'), 'qr.jpg');

    expect(response.status).toBe(400);
  });

  it('rejects a file larger than the configured ceiling', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;
    // test-env.ts sets MAX_IMAGE_UPLOAD_BYTES to 1MB for the suite.
    const tooLarge = Buffer.alloc(1024 * 1024 + 1, 0);

    const response = await uploadQrImage(seller, channelId, tooLarge);

    expect(response.status).toBe(413);
  });

  it('answers 404 reading a channel’s QR image before one has been uploaded', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;

    const response = await seller.get(`${API}/shops/me/payment-channels/${channelId}/qr-image`);

    expect(response.status).toBe(404);
  });

  it('answers 404 for another seller trying to read a QR image that is not theirs (L1 — no public route)', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;
    await uploadQrImage(seller, channelId, await aJpegBuffer());

    const otherSeller = await sellerWithShop(app, OTHER_SELLER);
    const response = await otherSeller.get(`${API}/shops/me/payment-channels/${channelId}/qr-image`);

    expect(response.status).toBe(404);
  });

  it('answers 401 for an anonymous request — there is no public endpoint for this at all', async () => {
    const app = getApp();
    const seller = await sellerWithShop(app, SELLER);
    const created = await create(seller, BANK_PAYLOAD);
    const channelId = (created.body as ChannelBody).id;
    await uploadQrImage(seller, channelId, await aJpegBuffer());

    const response = await newClient(app).get(`${API}/shops/me/payment-channels/${channelId}/qr-image`);

    expect(response.status).toBe(401);
  });
});

describe('sanity check: error body shape is the project’s usual one', () => {
  it('a 404 from this module still carries { code, message }', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, 'buyer2@example.test');

    const response = await create(buyer, BANK_PAYLOAD);

    expect((response.body as ErrorBody).code).toBe('NOT_FOUND');
  });
});
