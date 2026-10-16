import sharp from 'sharp';
import type { Agent } from 'supertest';
import { vi } from 'vitest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { FileStorageService } from '../src/files/file-storage.service.js';
import { CURRENT_PRIVACY_POLICY_VERSION } from '../src/legal/policy-version.js';
import { registerVerified } from './helpers/arrange.js';
import { API, csrfToken, login, redirectError, registerAndLogin, signInWithGoogle } from './helpers/auth.js';
import { approveProduct, approveShopAs, rejectProduct, rejectShopAs } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * §87: what the code reviews of §81–§86 found and set aside as out of their scope, decided by the
 * project owner on 2026-09-27 — one describe block per item.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const ERASE_REASON = 'คำขอลบข้อมูลตาม PDPA เลขที่ 2026-087 ส่งทางอีเมลถึงผู้ดูแลระบบ';

interface ProductBody {
  id: string;
  variants: { id: string }[];
}
interface OrderBody {
  id: string;
  status: string;
}
interface Page<T> {
  items: T[];
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function post(client: Agent, path: string, body?: object) {
  const request = client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client));
  return body === undefined ? request : request.send(body);
}

async function aJpegBuffer(green = 200): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: green, b: 0 } } }).jpeg().toBuffer();
}

/** A super admin, a community with a category, an approved shop with one approved product, and a buyer. */
async function marketplace(app: TestApp) {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const categoryId = ((await post(superAdmin, '/categories', { name: 'ขนมไทย' })).body as { id: string }).id;

  const seller = newClient(app);
  const sellerId = await registerVerified(app, seller, SELLER);
  const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
  await approveShopAs(superAdmin, shopId);

  const created = await post(seller, '/products', {
    name: 'ขนมชั้นใบเตย',
    description: 'คำอธิบายสินค้าสำหรับทดสอบ',
    categoryId,
    variants: [{ name: 'กล่องเล็ก', priceAmountMinor: 10000, stock: 20 }],
  });
  const productId = (created.body as { id: string }).id;
  await approveProduct(superAdmin, productId);
  const product = (await seller.get(`${API}/products/${productId}`)).body as ProductBody;

  const buyer = newClient(app);
  const buyerId = await registerVerified(app, buyer, BUYER);

  return { superAdmin, communityId, categoryId, seller, sellerId, shopId, product, buyer, buyerId };
}

async function placeOrder(app: TestApp, buyer: Agent, variantId: string): Promise<OrderBody> {
  const spc = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  const address = await post(buyer, '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId: spc.id });
  await post(buyer, '/cart/items', { variantId, quantity: 1 });
  const response = await checkoutAsShown(buyer, (address.body as { id: string }).id);

  return (response.body as OrderBody[])[0]!;
}

async function uploadPaymentSlip(buyer: Agent, orderId: string) {
  return buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
}

describe('§87 — lifting a ban withdraws the erasure an admin queued on the strength of it', () => {
  it('unban cancels an admin-requested erasure still waiting in the queue, and says so in audit_log', async () => {
    const app = getApp();
    const { superAdmin, product, buyer, buyerId } = await marketplace(app);
    await placeOrder(app, buyer, product.variants[0]!.id);
    await post(superAdmin, `/admin/users/${buyerId}/ban`, { reason: 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง' });
    expect((await post(superAdmin, `/admin/users/${buyerId}/erase`, { reason: ERASE_REASON })).status).toBe(202);

    expect((await post(superAdmin, `/admin/users/${buyerId}/unban`)).status).toBe(204);

    // The order that held the erasure up ends (clock 1 — the unban restarted it) and the sweep
    // gets its chance: nothing is queued any more, so nothing is erased.
    app.clock.advanceByHours(25);
    await app.sweep.run();
    await app.sweep.run();

    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).toBeNull();
    expect(row.email).toBe(BUYER);
    const superId = (await app.prisma.user.findUniqueOrThrow({ where: { email: SUPER } })).id;
    const cancelled = await app.prisma.auditLog.findMany({ where: { action: 'ACCOUNT_ERASURE_CANCELLED', targetId: buyerId } });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.actorUserId).toBe(superId);
    await login(buyer, BUYER);
    expect((await buyer.get(`${API}/auth/account/erasure-status`)).body).toMatchObject({ status: 'NONE' });
  });

  it('an erasure the account holder asked for themselves stays queued through a ban and an unban', async () => {
    const app = getApp();
    const { superAdmin, product, buyer, buyerId } = await marketplace(app);
    await placeOrder(app, buyer, product.variants[0]!.id);
    expect((await post(buyer, '/auth/account/erase')).status).toBe(202);
    await post(superAdmin, `/admin/users/${buyerId}/ban`, { reason: 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง' });
    await post(superAdmin, `/admin/users/${buyerId}/unban`);

    await login(buyer, BUYER);
    expect((await buyer.get(`${API}/auth/account/erasure-status`)).body).toMatchObject({ status: 'QUEUED' });
    expect(await app.prisma.auditLog.count({ where: { action: 'ACCOUNT_ERASURE_CANCELLED' } })).toBe(0);
  });
});

describe('§87 — a dispute that closed without a ruling cannot be ruled on afterwards', () => {
  it('buyer confirmed the refund while the dispute was open → ruling answers 409 and the shop keeps its record', async () => {
    const app = getApp();
    const { superAdmin, seller, sellerId, product, buyer } = await marketplace(app);
    const order = await placeOrder(app, buyer, product.variants[0]!.id);
    await post(seller, `/shops/me/orders/${order.id}/shipping-fee`, { shippingAmountMinor: 2000 });
    await uploadPaymentSlip(buyer, order.id);

    // Clock 3 runs out: the shop never confirmed, so the refund is ordered (I1).
    app.clock.advanceByDays(3);
    app.clock.advanceByHours(1);
    await app.sweep.run();
    await login(buyer, BUYER);
    await login(seller, SELLER);
    await login(superAdmin, SUPER);

    const opened = await buyer
      .post(`${API}/orders/${order.id}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'ร้านยังไม่คืนเงินให้เลยครับ ติดต่อไม่ได้')
      .attach('files', await aJpegBuffer(), 'evidence.jpg');
    expect(opened.status).toBe(201);
    const disputeId = (opened.body as { id: string }).id;
    await seller
      .post(`${API}/shops/me/orders/${order.id}/refund-slips`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', await aJpegBuffer(), 'refund-slip.jpg');
    expect((await post(buyer, `/orders/${order.id}/refund-received`)).status).toBe(200);

    const ruled = await post(superAdmin, `/disputes/${disputeId}/ruling`, {
      verdict: 'BUYER_WINS',
      reason: 'จากหลักฐานทั้งสองฝ่าย ร้านคืนเงินช้ากว่าที่ควร ผู้ซื้อจึงเป็นฝ่ายถูก',
    });

    expect(ruled.status).toBe(409);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } })).disputeLostCount).toBe(0);
    expect((await app.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } })).verdict).toBeNull();
  });
});

describe('§87 — an order cancelled because its product was ruled prohibited tells the buyer', () => {
  it('the buyer gets an in-app ORDER_CANCELLED_PROHIBITED notification pointing at the order', async () => {
    const app = getApp();
    const { superAdmin, seller, product, buyer, categoryId } = await marketplace(app);
    const order = await placeOrder(app, buyer, product.variants[0]!.id);
    // An edit puts the product back in the queue (A3), where a PROHIBITED ruling can reach it.
    const edited = await seller
      .patch(`${API}/products/${product.id}`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'ขนมชั้นใบเตยสูตรใหม่', description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId });
    expect(edited.status).toBe(200);

    const rejected = await rejectProduct(superAdmin, product.id, { category: 'PROHIBITED', reason: 'เป็นสินค้าที่กฎหมายห้ามขาย' });
    expect(rejected.status).toBe(200);
    expect(((await buyer.get(`${API}/orders/${order.id}`)).body as OrderBody).status).toBe('CANCELLED');

    const notifications = (await buyer.get(`${API}/notifications`)).body as Page<{ type: string; targetId: string; message: string }>;
    const notice = notifications.items.find((n) => n.type === 'ORDER_CANCELLED_PROHIBITED');
    expect(notice).toBeDefined();
    expect(notice!.targetId).toBe(order.id);
    expect(notice!.message).toContain('ต้องห้าม');
  });
});

describe('§87 — QR images: old files leave the disk, and the bytes are served private', () => {
  async function channelWithQr(app: TestApp) {
    const world = await marketplace(app);
    const created = await post(world.seller, '/shops/me/payment-channels', { type: 'PROMPTPAY', promptPayId: '0812345678' });
    const channelId = (created.body as { id: string }).id;
    await world.seller
      .post(`${API}/shops/me/payment-channels/${channelId}/qr-image`)
      .set(CSRF_HEADER, await csrfToken(world.seller))
      .attach('file', await aJpegBuffer(10), 'qr.jpg');
    const firstFileId = (await app.prisma.paymentChannel.findUniqueOrThrow({ where: { id: channelId } })).qrImageFileId!;

    return { ...world, channelId, firstFileId };
  }

  it('replacing a QR deletes the previous image — a PromptPay QR is somebody’s phone or ID number', async () => {
    const app = getApp();
    const { seller, channelId, firstFileId } = await channelWithQr(app);

    const replaced = await seller
      .post(`${API}/shops/me/payment-channels/${channelId}/qr-image`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', await aJpegBuffer(250), 'qr2.jpg');

    expect(replaced.status).toBe(200);
    expect(await app.app.get(FileStorageService).readImage(firstFileId)).toBeNull();
    const current = (await app.prisma.paymentChannel.findUniqueOrThrow({ where: { id: channelId } })).qrImageFileId!;
    expect(current).not.toBe(firstFileId);
    expect(await app.app.get(FileStorageService).readImage(current)).not.toBeNull();
  });

  it('deleting a channel deletes its QR image', async () => {
    const app = getApp();
    const { seller, channelId, firstFileId } = await channelWithQr(app);

    const removed = await seller.delete(`${API}/shops/me/payment-channels/${channelId}`).set(CSRF_HEADER, await csrfToken(seller));

    expect(removed.status).toBe(204);
    expect(await app.app.get(FileStorageService).readImage(firstFileId)).toBeNull();
  });

  it('the owner’s and the buyer’s QR routes both answer private, no-store and nosniff', async () => {
    const app = getApp();
    const { seller, buyer, product, channelId } = await channelWithQr(app);
    const order = await placeOrder(app, buyer, product.variants[0]!.id);
    await post(seller, `/shops/me/orders/${order.id}/shipping-fee`, { shippingAmountMinor: 2000 });

    const own = await seller.get(`${API}/shops/me/payment-channels/${channelId}/qr-image`);
    const buyers = await buyer.get(`${API}/orders/${order.id}/payment-channels/${channelId}/qr-image`);

    for (const response of [own, buyers]) {
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });
});

describe('§87 — admin accounts do not edit a shop profile (N29)', () => {
  it('a community admin with an old rejected shop gets 403 on PATCH /shops/me and POST /shops/me/logo', async () => {
    const app = getApp();
    const { superAdmin, communityId } = await marketplace(app);
    const former = newClient(app);
    const formerId = await registerVerified(app, former, 'former-seller@example.test');
    const shopId = ((await post(former, '/shops', { communityId, name: 'ร้านที่ถูกปฏิเสธ' })).body as { id: string }).id;
    await rejectShopAs(superAdmin, shopId, 'ข้อมูลร้านไม่ครบถ้วน กรุณายื่นใหม่');
    expect((await post(superAdmin, `/communities/${communityId}/admins`, { userId: formerId })).status).toBe(201);

    const edit = await former.patch(`${API}/shops/me`).set(CSRF_HEADER, await csrfToken(former)).send({ name: 'ชื่อใหม่ของร้านเก่า', description: '' });
    const logo = await former
      .post(`${API}/shops/me/logo`)
      .set(CSRF_HEADER, await csrfToken(former))
      .attach('file', await aJpegBuffer(), 'logo.jpg');

    expect(edit.status).toBe(403);
    expect(logo.status).toBe(403);
    expect((await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).name).toBe('ร้านที่ถูกปฏิเสธ');
  });
});

describe('§87 — order lists filter by status (#58)', () => {
  async function twoOrders(app: TestApp) {
    const world = await marketplace(app);
    const waiting = await placeOrder(app, world.buyer, world.product.variants[0]!.id);
    const cancelled = await placeOrder(app, world.buyer, world.product.variants[0]!.id);
    await post(world.buyer, `/orders/${cancelled.id}/cancel`, { reason: 'สั่งผิดรายการ ขอยกเลิกครับ' });

    return { ...world, waiting, cancelled };
  }

  it('the buyer’s list takes ?status=, one value or several', async () => {
    const app = getApp();
    const { buyer, waiting, cancelled } = await twoOrders(app);

    const one = await buyer.get(`${API}/orders`).query({ status: 'CANCELLED' });
    const both = await buyer.get(`${API}/orders?status=CANCELLED&status=AWAITING_SHIPPING_QUOTE`);

    expect(one.status).toBe(200);
    expect((one.body as Page<OrderBody>).items.map((o) => o.id)).toEqual([cancelled.id]);
    expect((both.body as Page<OrderBody>).items.map((o) => o.id).sort()).toEqual([waiting.id, cancelled.id].sort());
  });

  it('the shop’s list takes it too, and an unknown status is a 400', async () => {
    const app = getApp();
    const { seller, waiting } = await twoOrders(app);

    const filtered = await seller.get(`${API}/shops/me/orders`).query({ status: 'AWAITING_SHIPPING_QUOTE' });
    const bad = await seller.get(`${API}/shops/me/orders`).query({ status: 'PAID_MAYBE' });

    expect(filtered.status).toBe(200);
    expect((filtered.body as Page<OrderBody>).items.map((o) => o.id)).toEqual([waiting.id]);
    expect(bad.status).toBe(400);
  });
});

describe('§87 — a Google sign-up records the policy version the page actually showed', () => {
  it('a new account with no version, or a stale one, is refused with POLICY_VERSION_OUTDATED and nothing is created', async () => {
    const app = getApp();

    const missing = await signInWithGoogle(app.client, app.google, 'first@gmail.com', { policyVersion: null });
    const stale = await signInWithGoogle(newClient(app), app.google, 'second@gmail.com', { policyVersion: '1999-01-01' });

    expect(redirectError(missing)).toBe('POLICY_VERSION_OUTDATED');
    expect(redirectError(stale)).toBe('POLICY_VERSION_OUTDATED');
    expect(await app.prisma.user.count({ where: { email: { in: ['first@gmail.com', 'second@gmail.com'] } } })).toBe(0);
  });

  it('the current version creates the account and records exactly that version', async () => {
    const app = getApp();

    const response = await signInWithGoogle(app.client, app.google, 'fresh@gmail.com', { policyVersion: CURRENT_PRIVACY_POLICY_VERSION });

    expect(redirectError(response)).toBeNull();
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { email: 'fresh@gmail.com' },
      include: { policyAcceptances: { where: { document: 'PRIVACY_POLICY' } } },
    });
    expect(user.policyAcceptances.map((a) => a.policyVersion)).toEqual([CURRENT_PRIVACY_POLICY_VERSION]);
  });

  it('an existing account signs in without one — it accepted a policy when it was created', async () => {
    const app = getApp();
    await signInWithGoogle(app.client, app.google, 'returning@gmail.com');

    const again = await signInWithGoogle(newClient(app), app.google, 'returning@gmail.com', { policyVersion: null });

    expect(redirectError(again)).toBeNull();
  });
});

describe('§87 — applying for a shop while the same account is being erased', () => {
  it('an application that lands while the erasure commits is refused, and no shop is left on the erased account', async () => {
    const app = getApp();
    const { communityId } = await marketplace(app);
    const applicant = newClient(app);
    const applicantId = await registerVerified(app, applicant, 'applicant@example.test');
    const otherDevice = newClient(app);
    await login(otherDevice, 'applicant@example.test');
    const original = app.prisma.shop.findFirst.bind(app.prisma.shop);
    let erased = 0;
    vi.spyOn(app.prisma.shop, 'findFirst').mockImplementationOnce((async (args: unknown) => {
      const read = await original(args as never);
      erased = (await post(otherDevice, '/auth/account/erase')).status;
      return read;
    }) as never);

    const applied = await post(applicant, '/shops', { communityId, name: 'ชื่อจริงของผู้สมัคร' });

    expect(erased).toBe(204);
    expect(applied.status).toBe(401);
    expect(await app.prisma.shop.count({ where: { ownerId: applicantId } })).toBe(0);
  });
});
