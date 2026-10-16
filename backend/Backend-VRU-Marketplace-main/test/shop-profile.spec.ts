import type { Agent } from 'supertest';
import { vi } from 'vitest';
import { FileStorageService, UploadedTempFile } from '../src/files/file-storage.service.js';
import sharp from 'sharp';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProfileChange, approveShopAs, rejectProfileChange } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';

/**
 * #73 (N27): `Shop.name`/`description`/logo — required at application time, editable afterward
 * through `PATCH /shops/me` and `POST /shops/me/logo`, publicly readable through
 * `GET /shops/:shopId` and `GET /shops/:shopId/logo`. The PDPA-erasure overwrite these fields
 * need is `test/account-erasure.spec.ts`'s to prove, not this file's — this file is #73's own
 * scope: applying, editing, and reading.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const OTHER_SELLER = 'other-seller@example.test';

interface MyShopBody {
  id: string;
  name: string;
  description: string | null;
  hasLogo: boolean;
}

interface ShopBody {
  id: string;
  name: string;
  description: string | null;
  hasLogo: boolean;
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

async function apply(client: Agent, communityId: string, name: string) {
  return client
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ communityId, name });
}

/** A verified seller with an APPROVED shop named `ร้านทดสอบ`. */
async function sellerWithShop(app: TestApp, email: string): Promise<{ client: Agent; shopId: string }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, `ชุมชนของ ${email}`);

  const client = newClient(app);
  await registerVerified(app, client, email);
  const applied = await apply(client, communityId, 'ร้านทดสอบ');
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return { client, shopId };
}

async function updateProfile(client: Agent, payload: Record<string, unknown>) {
  return client.patch(`${API}/shops/me`).set(CSRF_HEADER, await csrfToken(client)).send(payload);
}

async function uploadLogo(client: Agent, buffer: Buffer, filename = 'logo.jpg') {
  return client
    .post(`${API}/shops/me/logo`)
    .set(CSRF_HEADER, await csrfToken(client))
    .attach('file', buffer, filename);
}

/**
 * §86: an approved shop's edit waits for review. `sellerWithShop` leaves the super admin signed in
 * on `app.client`, so this is the review step the older #73 tests below now need before the new
 * name or logo is live.
 */
async function approveAsSuper(app: TestApp, shopId: string): Promise<void> {
  const response = await approveProfileChange(app.client, shopId);
  expect(response.status).toBe(200);
}

async function aJpegBuffer(withExif = false): Promise<Buffer> {
  const image = sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 128, b: 255 } } });

  if (withExif) {
    return image.withExif({ IFD0: { Make: 'TestPhoneCo', GPSLatitude: '13.75' } }).jpeg().toBuffer();
  }

  return image.jpeg().toBuffer();
}

describe('applying to open a shop now requires a name (#73, N27)', () => {
  it('refuses an application with no name', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);

    const response = await seller
      .post(`${API}/shops`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ communityId });

    expect(response.status).toBe(400);
  });

  it('refuses an application with an empty-string name', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);

    const response = await apply(seller, communityId, '');

    expect(response.status).toBe(400);
  });

  it('accepts a real name and shows it back on GET /shops/me', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');

    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const response = await apply(seller, communityId, 'ร้านขนมไทยป้าแดง');

    expect(response.status).toBe(201);
    expect((response.body as MyShopBody).name).toBe('ร้านขนมไทยป้าแดง');
    expect((response.body as MyShopBody).description).toBeNull();
    expect((response.body as MyShopBody).hasLogo).toBe(false);
  });
});

describe('PATCH /shops/me — editing my own shop’s name and description (#73)', () => {
  it('replaces both fields once the change is approved (§86)', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);

    const response = await updateProfile(client, {
      name: 'ร้านใหม่',
      description: 'ขายของกินของใช้',
    });
    expect(response.status).toBe(200);
    await approveAsSuper(app, shopId);

    const body = (await client.get(`${API}/shops/me`)).body as MyShopBody;
    expect(body.name).toBe('ร้านใหม่');
    expect(body.description).toBe('ขายของกินของใช้');
  });

  it('an empty-string description collapses to null', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    await updateProfile(client, { name: 'ร้านใหม่', description: 'มีคำอธิบาย' });
    await approveAsSuper(app, shopId);

    await updateProfile(client, { name: 'ร้านใหม่', description: '' });
    await approveAsSuper(app, shopId);

    expect(((await client.get(`${API}/shops/me`)).body as MyShopBody).description).toBeNull();
  });

  it('a shop not yet approved takes the edit directly — its own approval is the review (§86)', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    await app.prisma.shop.update({ where: { id: shopId }, data: { approvalStatus: 'PENDING' } });

    const response = await updateProfile(client, { name: 'ชื่อก่อนอนุมัติ', description: '' });

    expect(response.status).toBe(200);
    expect((response.body as MyShopBody).name).toBe('ชื่อก่อนอนุมัติ');
  });

  it('does not reset any approval status — Shop.approvalStatus is a one-time gate, not ongoing moderation', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);

    await updateProfile(client, { name: 'ชื่อใหม่ที่เพิ่งเปลี่ยน', description: '' });
    await approveAsSuper(app, shopId);

    const row = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(row.approvalStatus).toBe('APPROVED');

    const publicView = await newClient(app).get(`${API}/shops/${shopId}`);
    expect(publicView.status).toBe(200);
    expect((publicView.body as ShopBody).name).toBe('ชื่อใหม่ที่เพิ่งเปลี่ยน');
  });

  it('refuses a name over the length ceiling', async () => {
    const app = getApp();
    const { client } = await sellerWithShop(app, SELLER);

    const response = await updateProfile(client, { name: 'ก'.repeat(201), description: '' });

    expect(response.status).toBe(400);
  });

  it('answers 404 for a signed-in account with no shop', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, 'buyer@example.test');

    const response = await updateProfile(buyer, { name: 'ไม่มีร้าน', description: '' });

    expect(response.status).toBe(404);
  });

  it('requires a session', async () => {
    const response = await updateProfile(newClient(getApp()), { name: 'x', description: '' });

    expect(response.status).toBe(401);
  });
});

describe('the shop’s storefront logo (#73 · K1 · N1)', () => {
  it('uploads a real jpeg and it becomes readable at the public GET /shops/:shopId/logo', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    const jpeg = await aJpegBuffer();

    const uploadResponse = await uploadLogo(client, jpeg);
    expect(uploadResponse.status).toBe(200);
    await approveAsSuper(app, shopId);
    expect(((await client.get(`${API}/shops/me`)).body as MyShopBody).hasLogo).toBe(true);

    // No session at all — a stranger browsing sees the same photo (invariant 1).
    const readResponse = await newClient(app).get(`${API}/shops/${shopId}/logo`);
    expect(readResponse.status).toBe(200);
    expect(readResponse.headers['content-type']).toContain('image/jpeg');
    expect((readResponse.body as Buffer).length).toBeGreaterThan(0);
  });

  it('strips EXIF metadata on upload (GPS coordinates must not survive)', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    const jpegWithExif = await aJpegBuffer(true);
    const sourceMetadata = await sharp(jpegWithExif).metadata();
    expect(sourceMetadata.exif).toBeDefined();

    await uploadLogo(client, jpegWithExif);
    await approveAsSuper(app, shopId);
    const readResponse = await newClient(app).get(`${API}/shops/${shopId}/logo`);

    const storedMetadata = await sharp(readResponse.body as Buffer).metadata();
    expect(storedMetadata.exif).toBeUndefined();
  });

  it('a second upload replaces the first', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    await uploadLogo(client, await aJpegBuffer());
    await approveAsSuper(app, shopId);
    const firstRead = await newClient(app).get(`${API}/shops/${shopId}/logo`);

    const secondJpeg = await sharp({
      create: { width: 30, height: 30, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    await uploadLogo(client, secondJpeg);
    await approveAsSuper(app, shopId);
    const secondRead = await newClient(app).get(`${API}/shops/${shopId}/logo`);

    expect((secondRead.body as Buffer).equals(firstRead.body as Buffer)).toBe(false);
  });

  it('rejects a file that is not really a jpeg/png, even named like one', async () => {
    const app = getApp();
    const { client } = await sellerWithShop(app, SELLER);

    const response = await uploadLogo(client, Buffer.from('not actually a jpeg'), 'logo.jpg');

    expect(response.status).toBe(400);
  });

  it('answers 404 reading a shop’s logo before one has been uploaded', async () => {
    const app = getApp();
    const { shopId } = await sellerWithShop(app, SELLER);

    const response = await newClient(app).get(`${API}/shops/${shopId}/logo`);

    expect(response.status).toBe(404);
  });

  it('answers 404 reading the logo of a shop id that does not exist at all', async () => {
    const app = getApp();

    const response = await newClient(app).get(`${API}/shops/${'0'.repeat(32)}/logo`);

    expect([400, 404]).toContain(response.status);
  });

  it('requires a session to upload', async () => {
    const response = await newClient(getApp())
      .post(`${API}/shops/me/logo`)
      .set(CSRF_HEADER, await csrfToken(newClient(getApp())))
      .attach('file', await aJpegBuffer(), 'logo.jpg');

    expect(response.status).toBe(401);
  });

  it('answers 404 uploading with a session but no shop', async () => {
    const app = getApp();
    const buyer = newClient(app);
    await registerAndLogin(buyer, 'buyer@example.test');

    const response = await buyer
      .post(`${API}/shops/me/logo`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', await aJpegBuffer(), 'logo.jpg');

    expect(response.status).toBe(404);
  });

  it('one seller’s logo upload never touches another seller’s shop', async () => {
    const app = getApp();
    const { client: sellerA, shopId: shopIdA } = await sellerWithShop(app, SELLER);
    const { shopId: shopIdB } = await sellerWithShop(app, OTHER_SELLER);

    await uploadLogo(sellerA, await aJpegBuffer());
    await approveAsSuper(app, shopIdA);

    const bRead = await newClient(app).get(`${API}/shops/${shopIdB}/logo`);
    expect(bRead.status).toBe(404);
    const aRead = await newClient(app).get(`${API}/shops/${shopIdA}/logo`);
    expect(aRead.status).toBe(200);
  });

  it('the logo link stays reachable after the shop closes — same reasoning as a product photo', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    await uploadLogo(client, await aJpegBuffer());
    await approveAsSuper(app, shopId);

    const closeResponse = await client.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(client));
    expect(closeResponse.status).toBe(200);

    const readResponse = await newClient(app).get(`${API}/shops/${shopId}/logo`);
    expect(readResponse.status).toBe(200);
  });
});

describe('sanity check: error body shape is the project’s usual one', () => {
  it('a 404 from this module still carries { code, message }', async () => {
    const app = getApp();
    const { shopId } = await sellerWithShop(app, SELLER);

    const response = await newClient(app).get(`${API}/shops/${shopId}/logo`);

    expect(response.status).toBe(404);
    const body = response.body as ErrorBody;
    expect(typeof body.code).toBe('string');
    expect(typeof body.message).toBe('string');
  });
});

describe('code review of #73–#75 (§86)', () => {
  interface PendingShopBody extends MyShopBody {
    pendingName: string | null;
    pendingDescription: string | null;
    hasPendingLogo: boolean;
    profileChangeRequestedAt: string | null;
    profileChangeRejectionReason: string | null;
  }

  async function communityAdmin(app: TestApp, shopId: string, email: string): Promise<Agent> {
    const communityId = (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } }))
      .communityId;
    const admin = newClient(app);
    const adminId = await registerVerified(app, admin, email);
    await app.client
      .post(`${API}/communities/${communityId}/admins`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ userId: adminId });
    return admin;
  }
  async function approveChange(admin: Agent, shopId: string, seen?: number) {
    return approveProfileChange(admin, shopId, seen);
  }
  async function rejectChange(admin: Agent, shopId: string, reason: string, seen?: number) {
    return rejectProfileChange(admin, shopId, reason, seen);
  }
  /** A shop straight from its application — still PENDING, never approved. */
  async function pendingShop(app: TestApp): Promise<{ client: Agent; shopId: string }> {
    await signInAsSuperAdmin(app, app.client);
    const communityId = await createCommunity(app.client, 'ชุมชนรอ');
    const client = newClient(app);
    await registerVerified(app, client, SELLER);
    const shopId = ((await apply(client, communityId, 'ร้านทดสอบ')).body as { id: string }).id;
    return { client, shopId };
  }
  async function differentJpeg(): Promise<Buffer> {
    return sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .jpeg()
      .toBuffer();
  }

  it('an approved shop’s edit waits for review — the storefront keeps the old name until a community admin approves', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    const admin = await communityAdmin(app, shopId, 'admin@example.test');

    const edited = await updateProfile(client, {
      name: 'ชื่อใหม่ของร้าน',
      description: 'คำอธิบายใหม่',
    });

    expect(edited.status).toBe(200);
    expect(edited.body as PendingShopBody).toMatchObject({
      name: 'ร้านทดสอบ',
      pendingName: 'ชื่อใหม่ของร้าน',
      pendingDescription: 'คำอธิบายใหม่',
    });
    expect(((await newClient(app).get(`${API}/shops/${shopId}`)).body as ShopBody).name).toBe(
      'ร้านทดสอบ',
    );
    const queue = (await admin.get(`${API}/shops/pending-profile-changes`)).body as {
      items: { shopId: string; pendingName: string }[];
    };
    expect(queue.items).toContainEqual(
      expect.objectContaining({ shopId, pendingName: 'ชื่อใหม่ของร้าน' }),
    );

    expect((await approveChange(admin, shopId)).status).toBe(200);

    expect(((await newClient(app).get(`${API}/shops/${shopId}`)).body as ShopBody).name).toBe(
      'ชื่อใหม่ของร้าน',
    );
    const entry = await app.prisma.auditLog.findFirstOrThrow({
      where: { action: 'SHOP_PROFILE_APPROVED', targetId: shopId },
    });
    expect(entry.communityId).not.toBeNull();
    const notes = (await client.get(`${API}/notifications`)).body as { items: { type: string }[] };
    expect(notes.items.map((n) => n.type)).toContain('SHOP_PROFILE_APPROVED');
  });

  it('a rejected edit is dropped, the storefront never changes, and the owner reads why', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    const admin = await communityAdmin(app, shopId, 'admin@example.test');
    await updateProfile(client, { name: 'ชื่อที่ไม่เหมาะสม', description: '' });

    expect(
      (await rejectChange(admin, shopId, 'ชื่อร้านมีคำไม่เหมาะสม กรุณาแก้ไขใหม่')).status,
    ).toBe(200);

    const mine = (await client.get(`${API}/shops/me`)).body as PendingShopBody;
    expect(mine).toMatchObject({
      name: 'ร้านทดสอบ',
      pendingName: null,
      profileChangeRejectionReason: 'ชื่อร้านมีคำไม่เหมาะสม กรุณาแก้ไขใหม่',
    });
    expect(((await newClient(app).get(`${API}/shops/${shopId}`)).body as ShopBody).name).toBe(
      'ร้านทดสอบ',
    );
    const notes = (await client.get(`${API}/notifications`)).body as { items: { type: string }[] };
    expect(notes.items.map((n) => n.type)).toContain('SHOP_PROFILE_REJECTED');
  });

  it('a new logo on an approved shop is not public until approved; the admin can see it first; approving deletes the old file', async () => {
    const app = getApp();
    const { client, shopId } = await pendingShop(app);
    const admin = await communityAdmin(app, shopId, 'admin@example.test');
    // A logo set while the shop is still pending goes live at once — the shop's own approval reviews it.
    await uploadLogo(client, await aJpegBuffer());
    const firstLogoId = (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } }))
      .logoFileId!;
    await approveShopAs(app.client, shopId);
    const before = (await newClient(app).get(`${API}/shops/${shopId}/logo`)).body as Buffer;

    await uploadLogo(client, await differentJpeg());

    expect(
      ((await newClient(app).get(`${API}/shops/${shopId}/logo`)).body as Buffer).equals(before),
    ).toBe(true);
    const pending = await admin.get(`${API}/shops/${shopId}/pending-logo`);
    expect(pending.status).toBe(200);
    expect(pending.headers['cache-control']).toBe('private, no-store');

    await approveChange(admin, shopId);

    expect(
      ((await newClient(app).get(`${API}/shops/${shopId}/logo`)).body as Buffer).equals(before),
    ).toBe(false);
    expect(await app.app.get(FileStorageService).readImage(firstLogoId)).toBeNull();
    expect(await app.prisma.uploadedFile.count()).toBe(1);
  });

  it('replacing a logo before approval never leaves the earlier file on disk (K1)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนรอ');
    const client = newClient(app);
    await registerVerified(app, client, SELLER);
    const shopId = ((await apply(client, communityId, 'ร้านรออนุมัติ')).body as { id: string }).id;
    await uploadLogo(client, await aJpegBuffer());
    const firstLogoId = (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } }))
      .logoFileId!;

    await uploadLogo(client, await differentJpeg());

    expect(await app.app.get(FileStorageService).readImage(firstLogoId)).toBeNull();
    expect(await app.prisma.uploadedFile.count()).toBe(1);
  });

  it('a never-approved shop’s logo is hidden from the public like the shop itself — but its owner still sees it', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนรอ');
    const client = newClient(app);
    await registerVerified(app, client, SELLER);
    const shopId = ((await apply(client, communityId, 'ร้านรออนุมัติ')).body as { id: string }).id;
    await uploadLogo(client, await aJpegBuffer());

    expect((await newClient(app).get(`${API}/shops/${shopId}`)).status).toBe(404);
    expect((await newClient(app).get(`${API}/shops/${shopId}/logo`)).status).toBe(404);
    expect((await client.get(`${API}/shops/${shopId}/logo`)).status).toBe(200);
  });

  it('a logo upload that lands while the owner’s erasure commits never attaches to the erased shop', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    await client.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(client));
    const otherDevice = newClient(app);
    await login(otherDevice, SELLER);
    const files = app.app.get(FileStorageService);
    const original = files.storeImage.bind(files);
    let erased = 0;
    vi.spyOn(files, 'storeImage').mockImplementationOnce(async (upload: UploadedTempFile) => {
      const stored = await original(upload);
      erased = (
        await otherDevice
          .post(`${API}/auth/account/erase`)
          .set(CSRF_HEADER, await csrfToken(otherDevice))
      ).status;
      return stored;
    });

    const upload = await uploadLogo(client, await aJpegBuffer());

    expect(erased).toBe(204);
    expect(upload.status).not.toBe(200);
    const row = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(row.logoFileId).toBeNull();
    expect(row.pendingLogoFileId).toBeNull();
    expect(await app.prisma.uploadedFile.count()).toBe(0);
  });

  it('a profile edit that lands while the owner’s erasure commits never writes the real name back', async () => {
    const app = getApp();
    const { client, shopId } = await pendingShop(app);
    await client.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(client)); // K15: erasure needs it closed
    const otherDevice = newClient(app);
    await login(otherDevice, SELLER);
    const original = app.prisma.shop.findFirst.bind(app.prisma.shop);
    let erased = 0;
    vi.spyOn(app.prisma.shop, 'findFirst').mockImplementationOnce((async (args: unknown) => {
      const read = await original(args as never);
      erased = (
        await otherDevice
          .post(`${API}/auth/account/erase`)
          .set(CSRF_HEADER, await csrfToken(otherDevice))
      ).status;
      return read;
    }) as never);

    await updateProfile(client, { name: 'ชื่อจริงของเจ้าของ', description: 'ที่อยู่ร้านจริง' });

    expect(erased).toBe(204);
    const row = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(row.name).not.toBe('ชื่อจริงของเจ้าของ');
    expect(row.description).not.toBe('ที่อยู่ร้านจริง');
  });

  it('PDPA erasure also drops a pending profile change and deletes its pending logo', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    await updateProfile(client, { name: 'ชื่อที่รอตรวจ', description: 'คำอธิบายที่รอตรวจ' });
    await uploadLogo(client, await aJpegBuffer());
    const pendingLogoId = (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } }))
      .pendingLogoFileId!;
    await client.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(client));

    expect(
      (await client.post(`${API}/auth/account/erase`).set(CSRF_HEADER, await csrfToken(client)))
        .status,
    ).toBe(204);

    const row = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(row).toMatchObject({
      pendingName: null,
      pendingDescription: null,
      pendingLogoFileId: null,
      profileChangeRequestedAt: null,
    });
    // Erasure keeps the file row and deletes the bytes — the same treatment the live logo gets.
    expect(await app.app.get(FileStorageService).readImage(pendingLogoId)).toBeNull();
  });

  it('🚨 a community admin of another community cannot approve or reject this shop’s change', async () => {
    const app = getApp();
    const { client, shopId } = await sellerWithShop(app, SELLER);
    await updateProfile(client, { name: 'ชื่อใหม่ของร้าน', description: '' });
    const otherCommunity = await createCommunity(app.client, 'ชุมชนอื่น');
    const outsider = newClient(app);
    const outsiderId = await registerVerified(app, outsider, 'outsider@example.test');
    await app.client
      .post(`${API}/communities/${otherCommunity}/admins`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ userId: outsiderId });

    // §91: the outsider's queue never shows this change, so there is no revision to read — the
    // guard must refuse before it matters.
    expect((await approveChange(outsider, shopId, 0)).status).toBe(403);
    expect((await rejectChange(outsider, shopId, 'พยายามปฏิเสธข้ามชุมชน', 0)).status).toBe(403);
    expect((await outsider.get(`${API}/shops/${shopId}/pending-logo`)).status).toBe(403);
  });

  it('answers 404 for a well-formed shop id that does not exist', async () => {
    const app = getApp();

    const response = await newClient(app).get(
      `${API}/shops/01900000-0000-7000-8000-000000000000/logo`,
    );

    expect(response.status).toBe(404);
  });
});
