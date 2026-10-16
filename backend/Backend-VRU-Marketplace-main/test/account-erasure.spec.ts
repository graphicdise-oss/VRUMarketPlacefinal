import sharp from 'sharp';
import { vi } from 'vitest';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { AccountMarkerService } from '../src/auth/account-marker.service.js';
import { ERASED_BUYER_TEXT_PLACEHOLDER, ERASED_CHAT_MESSAGE_PLACEHOLDER } from '../src/account-erasure/erasure-placeholders.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, CURRENT_ACCEPTANCES, csrfToken, forgotPassword, linkTokenFrom, login, registerAndLogin, resetPassword } from './helpers/auth.js';
import { approveProduct, approveProfileChange } from './helpers/review.js';
import { FileStorageService } from '../src/files/file-storage.service.js';
import { SessionService } from '../src/auth/session.service.js';
import { ShopService } from '../src/shop/services/shop.service.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';
import { pauseNextTransactionAfterRawQuery, untilSomeoneWaitsOnALock } from './helpers/interleave.js';

/**
 * #70/#71 (G3 · H8 · H9 · H10 · K15 · K16 · N4): PDPA erasure — overwrite everywhere PII was
 * copied to, `DELETE` nowhere. An open shop still refuses outright (K15, only the owner can close
 * it); a non-terminal order queues instead of refusing (H9) and clears on its own once nothing
 * blocks, including H10's own 15-day-after-shipped cutoff for an order nobody ever marks received.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
  recipientName: string;
  phone: string;
  houseNumber: string;
  subdistrictName: string;
  districtName: string;
  provinceName: string;
  postalCode: string;
  totalAmountMinor: number | null;
}
interface AddressBody {
  id: string;
  recipientName: string;
  phone: string;
}
interface ChannelBody {
  id: string;
  bankAccountNumber: string | null;
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

async function createAddress(app: TestApp, client: Agent): Promise<AddressBody> {
  const subdistrictPostalCodeId = await aRealSubdistrictPostalCodeId(app);
  const response = await client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId });

  return response.body as AddressBody;
}

async function placeOrder(buyer: Agent, addressId: string, variantId: string): Promise<OrderBody> {
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

async function uploadPaymentSlip(buyer: Agent, orderId: string): Promise<{ id: string }> {
  const response = await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
  return response.body as { id: string };
}

async function confirmPayment(seller: Agent, orderId: string) {
  return seller.post(`${API}/shops/me/orders/${orderId}/confirm-payment`).set(CSRF_HEADER, await csrfToken(seller));
}

async function ship(app: TestApp, seller: Agent, orderId: string) {
  // Not seeded in the test database (only categories/carriers seeded for the real dev DB) —
  // created once and reused, the same "find or create" shortcut other specs use for reference
  // rows this suite has no endpoint to fetch cheaply.
  let carrier = await app.prisma.shippingCarrier.findFirst();
  carrier ??= await app.prisma.shippingCarrier.create({
    data: { id: newId(), name: 'Kerry', createdAt: app.clock.now(), updatedAt: app.clock.now() },
  });

  return seller
    .post(`${API}/shops/me/orders/${orderId}/ship`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' });
}

async function markReceived(buyer: Agent, orderId: string) {
  return buyer.post(`${API}/orders/${orderId}/receive`).set(CSRF_HEADER, await csrfToken(buyer));
}

async function writeReview(buyer: Agent, orderId: string, rating: number, text?: string) {
  return buyer
    .post(`${API}/orders/${orderId}/review`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ rating, ...(text !== undefined ? { text } : {}) });
}

async function closeShop(seller: Agent, shopId: string) {
  return seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller));
}

async function ban(client: Agent, userId: string, reason = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง') {
  return client
    .post(`${API}/admin/users/${userId}/ban`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ reason });
}

async function createPaymentChannel(seller: Agent, payload: Record<string, unknown>): Promise<ChannelBody> {
  const response = await seller
    .post(`${API}/shops/me/payment-channels`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send(payload);
  return response.body as ChannelBody;
}

async function uploadQrImage(seller: Agent, channelId: string) {
  return seller
    .post(`${API}/shops/me/payment-channels/${channelId}/qr-image`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .attach('file', await aJpegBuffer(), 'qr.jpg');
}

/** #73: uploads the caller's own shop's storefront logo. */
async function uploadShopLogo(seller: Agent) {
  return seller
    .post(`${API}/shops/me/logo`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .attach('file', await aJpegBuffer(), 'logo.jpg');
}

type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };

const openSockets: ClientSocket[] = [];

afterEach(() => {
  for (const socket of openSockets) {
    socket.disconnect();
  }
  openSockets.length = 0;
});

async function connectedChatSocket(app: TestApp, client: Agent): Promise<ClientSocket> {
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

async function uploadChatPicture(client: Agent, roomId: string): Promise<string> {
  const response = await client
    .post(`${API}/chat-rooms/${roomId}/attachments`)
    .set(CSRF_HEADER, await csrfToken(client))
    .attach('file', await aJpegBuffer(), 'chat.jpg');

  return (response.body as { fileId: string }).fileId;
}

/** §86: an admin erasure names the request it acts on — the reference of the PDPA request received (§68). */
const ERASE_REASON = 'คำขอลบข้อมูลตาม PDPA เลขที่ 2026-001 ส่งผ่านแอดมินชุมชน';

async function eraseAsAdmin(superAdmin: Agent, userId: string) {
  return superAdmin
    .post(`${API}/admin/users/${userId}/erase`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ reason: ERASE_REASON });
}

async function eraseAccount(client: Agent) {
  return client.post(`${API}/auth/account/erase`).set(CSRF_HEADER, await csrfToken(client));
}

/**
 * A full, real order: checkout → shipping fee → slip → confirm → ship → buyer marks received
 * (COMPLETED, terminal) — so the buyer's erasure test below has a payment slip file to check for
 * deletion and a completed order it can attach a review to.
 */
async function completedOrderScenario(app: TestApp): Promise<{
  superAdmin: Agent;
  seller: Agent;
  sellerId: string;
  shopId: string;
  buyer: Agent;
  buyerId: string;
  order: OrderBody;
  addressId: string;
}> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบลบข้อมูล', 10000, 5);
  const buyer = newClient(app);
  const buyerId = await registerVerified(app, buyer, BUYER);
  const address = await createAddress(app, buyer);
  const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
  await setShippingFee(seller, order.id, 2000);
  await uploadPaymentSlip(buyer, order.id);
  await confirmPayment(seller, order.id);
  await ship(app, seller, order.id);
  await markReceived(buyer, order.id);

  return { superAdmin, seller, sellerId, shopId, buyer, buyerId, order, addressId: address.id };
}

describe('#70 — happy path: a buyer with nothing pending erases their own account', () => {
  it('overwrites PII everywhere, deletes no row, keeps order history, and logs the caller out', async () => {
    const app = getApp();
    const { seller, buyer, buyerId, order, addressId } = await completedOrderScenario(app);
    await writeReview(buyer, order.id, 5, 'สินค้าดีมากครับ');

    const orderRowBefore = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const totalBefore = orderRowBefore.totalAmountMinor;
    const statusBefore = orderRowBefore.status;

    const response = await eraseAccount(buyer);
    expect(response.status).toBe(204);
    // Erasure ends the session — the request that just erased it also gets its cookies cleared.
    const setCookie: unknown = response.headers['set-cookie'];
    const setCookieValues: string[] = Array.isArray(setCookie) ? (setCookie as string[]) : typeof setCookie === 'string' ? [setCookie] : [];
    expect(setCookieValues.some((c) => c.startsWith('access_token='))).toBe(true);

    const userRow = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(userRow.id).toBe(buyerId); // same row, same id — never DELETEd
    expect(userRow.email).toMatch(/^deleted-.+@erased\.invalid$/);
    expect(userRow.passwordHash).toBeNull();
    expect(userRow.erasedAt).not.toBeNull();

    const addressRow = await app.prisma.address.findUniqueOrThrow({ where: { id: addressId } });
    expect(addressRow.recipientName).not.toBe('สมชาย ใจดี');
    expect(addressRow.phone).not.toBe('0812345678');

    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderRow.recipientName).not.toBe('สมชาย ใจดี');
    expect(orderRow.phone).not.toBe('0812345678');
    // The transaction itself, its status, and its amount are not PII — untouched.
    expect(orderRow.totalAmountMinor).toBe(totalBefore);
    expect(orderRow.status).toBe(statusBefore);

    // The shop still sees its own sale — items, amount, status readable exactly as before.
    const shopView = await seller.get(`${API}/orders/${order.id}`);
    expect(shopView.status).toBe(200);
    expect((shopView.body as OrderBody).totalAmountMinor).toBe(totalBefore);

    // The review stays and its rating still counts; §96 (owner's decision) overwrites its text —
    // the buyer's own words, which #70 used to keep.
    const reviewRow = await app.prisma.review.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(reviewRow.rating).toBe(5);
    expect(reviewRow.text).toBe(ERASED_BUYER_TEXT_PLACEHOLDER);
    expect(reviewRow.buyerId).toBe(buyerId); // FK still points at the (now anonymized) row

    // Audit trail.
    const auditRow = await app.prisma.auditLog.findFirst({ where: { action: 'ACCOUNT_ERASED', targetId: buyerId } });
    expect(auditRow).not.toBeNull();

    // K16 marker.
    const markers = await app.prisma.deletedAccountMarker.findMany();
    expect(markers).toHaveLength(1);
    expect(markers[0]?.wasBanned).toBe(false);
    expect(markers[0]?.disputeLostCount).toBe(0);

    // Logged out everywhere: the old cookies no longer authenticate.
    const stillLoggedIn = await buyer.get(`${API}/orders/${order.id}`);
    expect(stillLoggedIn.status).toBe(401);
  });

  it('deletes the buyer’s own payment-slip file bytes, but keeps the slip row', async () => {
    const app = getApp();
    const { seller, buyer, order } = await completedOrderScenario(app);
    const slip = await app.prisma.paymentSlip.findFirstOrThrow({ where: { orderId: order.id } });

    await eraseAccount(buyer);

    const fileRow = await app.prisma.uploadedFile.findUniqueOrThrow({ where: { id: slip.fileId } });
    expect(fileRow).not.toBeNull(); // the row survives — "still knows a slip existed"
    const slipRowAfter = await app.prisma.paymentSlip.findUniqueOrThrow({ where: { id: slip.id } });
    expect(slipRowAfter.id).toBe(slip.id);

    // The bytes themselves are gone — the shop's own (still valid) session reading the same
    // file it could read a moment ago now gets nothing, not a 500.
    await login(seller, SELLER);
    const read = await seller.get(`${API}/orders/${order.id}/payment-slips/${slip.id}/file`);
    expect(read.status).toBe(404);
  });
});

describe('#70/#71 — refused outright (never queued)', () => {
  it('refuses while the caller still owns an open shop (K15 — only the owner can close it)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const { seller } = await sellerWithShop(app, SELLER, communityId);

    const response = await eraseAccount(seller);
    expect(response.status).toBe(409);

    // Never queued — a sweep re-checking this account later would find nothing to do, and
    // `erasureRequestedAt` must stay null so `GET erasure-status` correctly reports NONE.
    const sellerId = (await app.prisma.user.findFirstOrThrow({ where: { email: SELLER } })).id;
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    expect(row.erasureRequestedAt).toBeNull();
  });

  it('refuses a second erasure attempt outright (idempotency gate) — and the erased account’s own session cannot even ask', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const staleDevice = newClient(app);
    await login(staleDevice, BUYER);
    expect((await ban(superAdmin, buyerId)).status).toBe(204);
    expect((await eraseAsAdmin(superAdmin, buyerId)).status).toBe(204);

    // §84: through real paths — this test used to set `erasedAt` through Prisma on an account
    // that still held a live session, a state erasure itself never leaves behind.
    expect((await eraseAsAdmin(superAdmin, buyerId)).status).toBe(409);
    // A banned account hears about the ban first (SessionService's own order); the erased,
    // never-banned case answers 401 — see "sessions stop working" in the §84 block below.
    expect((await staleDevice.get(`${API}/auth/account/erasure-status`)).status).toBe(403);
  });
});

describe('#71 (H9) — a non-terminal order queues the request instead of refusing it', () => {
  it('queues a buyer whose order is still AWAITING_SHIPPING_QUOTE, with the order listed as a blocker', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id); // still AWAITING_SHIPPING_QUOTE

    const response = await eraseAccount(buyer);
    expect(response.status).toBe(202);
    const body = response.body as { status: string; requestedAt: string; blockers: { orderId: string; role: string; status: string; clearsAt: string | null }[] };
    expect(body.status).toBe('QUEUED');
    expect(body.blockers).toHaveLength(1);
    expect(body.blockers[0]?.orderId).toBe(order.id);
    expect(body.blockers[0]?.role).toBe('BUYER');
    expect(body.blockers[0]?.status).toBe('AWAITING_SHIPPING_QUOTE');
    expect(body.blockers[0]?.clearsAt).toBeNull(); // H10 only fires for a shipped order

    // The account is not erased, not logged out, and fully usable while queued.
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).toBeNull();
    expect(row.erasureRequestedAt).not.toBeNull();
    const stillUsable = await buyer.get(`${API}/orders/${order.id}`);
    expect(stillUsable.status).toBe(200);
  });

  it('queues a seller with a closed shop that still has a frozen order', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(app, seller, order.id); // SHIPPED — #39 is the one non-terminal status that does not block a close
    await closeShop(seller, shopId);

    // #39 already rules out every other way a *closed* shop could still have something
    // outstanding — the only route left is freezing a SHIPPED order after the fact (I6), which
    // this erasure request must still catch even though the shop itself is gone.
    await ban(superAdmin, buyerId);

    const response = await eraseAccount(seller);
    expect(response.status).toBe(202);
    const body = response.body as { blockers: { role: string }[] };
    expect(body.blockers).toHaveLength(1);
    expect(body.blockers[0]?.role).toBe('SELLER');

    void shopId;
  });

  it('repeating the request while already queued keeps the original requestedAt', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    await placeOrder(buyer, address.id, product.variants[0]!.id);

    const first = await eraseAccount(buyer);
    const second = await eraseAccount(buyer);

    expect(second.status).toBe(202);
    const firstBody = first.body as { requestedAt: string };
    const secondBody = second.body as { requestedAt: string };
    expect(secondBody.requestedAt).toBe(firstBody.requestedAt);
  });
});

describe('#71 (H9) — GET erasure-status', () => {
  it('reports NONE, then QUEUED with the blocker, then ERASED', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);

    const before = await buyer.get(`${API}/auth/account/erasure-status`);
    expect((before.body as { status: string }).status).toBe('NONE');

    await eraseAccount(buyer);
    const queued = await buyer.get(`${API}/auth/account/erasure-status`);
    const queuedBody = queued.body as { status: string; blockers: { orderId: string }[] };
    expect(queuedBody.status).toBe('QUEUED');
    expect(queuedBody.blockers[0]?.orderId).toBe(order.id);

    // Cancel the order so nothing blocks anymore, then let the sweep clear the queue.
    await buyer.post(`${API}/orders/${order.id}/cancel`).set(CSRF_HEADER, await csrfToken(buyer)).send({ reason: 'เปลี่ยนใจ' });
    await app.sweep.run();

    // The account is logged out now (erasure revokes every session) — read the status as a fresh
    // login would fail (the email is gone), so confirm through the row directly instead.
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).not.toBeNull();
  });
});

describe('#71 (H10) — a queued request clears once every order does, on the sweep’s own schedule', () => {
  it('clears exactly at 15 days after shippedAt, even though the buyer never marks it received', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ H10', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(app, seller, order.id);
    // Deliberately no markReceived — H10's own point: "ไม่ต้องรอผู้ซื้อกดรับของ", proven by never
    // calling it at all, not just by not waiting for it.

    app.email.clear();
    const queuedResponse = await eraseAccount(buyer);
    expect(queuedResponse.status).toBe(202);

    app.clock.advanceByDays(15);
    await app.sweep.run();

    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).not.toBeNull();
    expect(row.email).toMatch(/^deleted-.+@erased\.invalid$/);

    // I17: the completion email, sent to the *original* address — the row above already carries
    // the placeholder by the time this assertion runs, so this also proves `notify` used the
    // address captured before the overwrite, not a fresh (by-then-wrong) DB lookup.
    const sent = app.email.ofKind('ACCOUNT_ERASURE');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(BUYER);
  });

  it('does not clear one day early (14 days after shippedAt)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(app, seller, order.id);
    await eraseAccount(buyer);

    app.clock.advanceByDays(14);
    await app.sweep.run();

    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).toBeNull();
    void order;
  });

  it('does not clear an order that reached PAID but was never shipped, however long the wait', async () => {
    // PAID is deliberately the status used here, not AWAITING_SHIPPING_QUOTE/AWAITING_PAYMENT —
    // those two have their own 24h expiry sweeps (clocks 1–2) that would cancel an untouched
    // order long before this test's 60-day wait, making it terminal for an unrelated reason and
    // defeating the point. PAID has no such clock (D5b's own window only starts once shipped) —
    // a shop that never ships leaves an order sitting at PAID forever, which is exactly the case
    // this ticket's own AC calls out: "ยังไม่ถึงส่งแล้ว (ยังอยู่เรือน 1–3) → คำขอยังค้าง ไม่ลบ".
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id); // now PAID — never shipped in this test
    await eraseAccount(buyer);

    app.clock.advanceByDays(60);
    await app.sweep.run();

    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).toBeNull();
    const orderRow = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderRow.status).toBe('PAID');
  });

  it('does not clear a shipped order that is currently frozen, even past 15 days', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, sellerId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(app, seller, order.id);
    await eraseAccount(buyer);

    // I10: banning the seller freezes every non-terminal order their shop holds, this one included.
    await superAdmin.post(`${API}/admin/users/${sellerId}/ban`).set(CSRF_HEADER, await csrfToken(superAdmin)).send({ reason: 'แบนเพื่อทดสอบกลไกแช่แข็งออเดอร์' });

    app.clock.advanceByDays(20);
    await app.sweep.run();

    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).toBeNull();
    void order;
  });
});

describe('#70 (K15) — erasing a seller wipes their shop’s payment channels, but keeps refund-slip evidence (N4 · §84)', () => {
  it('nulls bank/PromptPay fields, deletes the QR file, keeps every row — and the refund slip stays readable to the buyer', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, sellerId, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบคืนเงิน', 10000, 5);
    const channel = await createPaymentChannel(seller, { type: 'BANK_TRANSFER', bankName: 'ธนาคารกรุงไทย', bankAccountNumber: '1234567890', bankAccountName: 'ร้านค้าทดสอบ' });
    await uploadQrImage(seller, channel.id);

    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);

    // Clock 3 timeout → REFUND_ORDERED (terminal-bound loop), then close the loop for real.
    app.clock.advanceByDays(3);
    await app.sweep.run();
    await login(seller, SELLER);
    await login(buyer, BUYER);
    const refundSlip = await seller
      .post(`${API}/shops/me/orders/${order.id}/refund-slips`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', await aJpegBuffer(), 'refund-slip.jpg');
    await buyer.post(`${API}/orders/${order.id}/refund-received`).set(CSRF_HEADER, await csrfToken(buyer));

    await login(seller, SELLER);
    await closeShop(seller, shopId);

    const qrFileId = (await app.prisma.paymentChannel.findUniqueOrThrow({ where: { id: channel.id } })).qrImageFileId!;
    const refundSlipId = (refundSlip.body as { id: string }).id;
    const refundSlipFileIdBefore = (await app.prisma.refundSlip.findUniqueOrThrow({ where: { id: refundSlipId } })).fileId;

    const response = await eraseAccount(seller);
    expect(response.status).toBe(204);

    const channelRow = await app.prisma.paymentChannel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(channelRow.bankAccountNumber).toBeNull();
    expect(channelRow.bankAccountName).toBeNull();
    expect(channelRow.bankName).toBeNull();
    expect(channelRow.qrImageFileId).toBeNull();

    // The QR's UploadedFile row still exists (row kept, bytes gone).
    expect(await app.prisma.uploadedFile.findUnique({ where: { id: qrFileId } })).not.toBeNull();
    const refundSlipAfter = await app.prisma.refundSlip.findUniqueOrThrow({ where: { id: refundSlipId } });
    expect(refundSlipAfter.fileId).toBe(refundSlipFileIdBefore);

    // §84 (project owner, N4): "สลิปเก่าลบไม่ได้เพราะเป็นหลักฐาน" — the refund slip is the buyer's
    // only proof the shop paid them back, so erasing the shop owner leaves it readable.
    await login(buyer, BUYER);
    const refundSlipFile = await buyer.get(`${API}/orders/${order.id}/refund-slips/${refundSlipId}/file`);
    expect(refundSlipFile.status).toBe(200);

    void sellerId;
  });
});

describe('#73 (N27, N4/K15) — erasing a seller overwrites their shop’s name and deletes its logo', () => {
  it('overwrites name, nulls description, deletes the logo file, keeps the row', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);

    await seller
      .patch(`${API}/shops/me`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ name: 'ร้านขนมไทยป้าแดง', description: 'ขายขนมไทยแท้ๆ' });
    const logoUpload = await uploadShopLogo(seller);
    expect(logoUpload.status).toBe(200);
    // §86: on an approved shop both edits wait for review — put them live first.
    const approved = await approveProfileChange(superAdmin, shopId);
    expect(approved.status).toBe(200);
    const logoFileId = (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } }))
      .logoFileId!;

    await closeShop(seller, shopId);
    const response = await eraseAccount(seller);
    expect(response.status).toBe(204);

    const shopRow = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shopRow.name).not.toBe('ร้านขนมไทยป้าแดง');
    expect(shopRow.name).toContain('PDPA');
    expect(shopRow.description).toBeNull();
    expect(shopRow.logoFileId).toBeNull();

    // Row kept (invariant 5's PDPA exception — overwrite, never DELETE), bytes gone.
    expect(await app.prisma.uploadedFile.findUnique({ where: { id: logoFileId } })).not.toBeNull();
    const logoRead = await newClient(app).get(`${API}/shops/${shopId}/logo`);
    expect(logoRead.status).toBe(404);

    // The shop's public page still resolves (I14/#37's own reasoning) — just with the
    // overwritten name, not a broken link.
    const publicView = await newClient(app).get(`${API}/shops/${shopId}`);
    expect(publicView.status).toBe(200);
    expect((publicView.body as { name: string }).name).toBe(shopRow.name);
  });

  it('a shop with no logo uploaded erases cleanly — the name overwrite does not depend on one existing', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);

    await closeShop(seller, shopId);
    const response = await eraseAccount(seller);
    expect(response.status).toBe(204);

    const shopRow = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shopRow.name).toContain('PDPA');
    expect(shopRow.logoFileId).toBeNull();
  });
});

describe('#70 (H8) — erasing a chat participant overwrites only their own messages', () => {
  it('leaves the room and the other party’s messages untouched, and deletes the pictures they sent or left unsent (K1 · §84)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);

    // §84: over the real socket — this test used to insert the room and messages through Prisma.
    const buyerSocket = await connectedChatSocket(app, buyer);
    const room = await emitAck<{ id: string }>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = room.ok ? room.data.id : '';
    await emitAck(buyerSocket, 'sendMessage', { roomId, content: 'สอบถามสินค้าครับ ที่อยู่ผมคือ 99/9' });
    const sentPicture = await uploadChatPicture(buyer, roomId);
    await emitAck(buyerSocket, 'sendMessage', { roomId, fileId: sentPicture });
    const unsentPicture = await uploadChatPicture(buyer, roomId);
    buyerSocket.disconnect();
    const sellerSocket = await connectedChatSocket(app, seller);
    await emitAck(sellerSocket, 'sendMessage', { roomId, content: 'มีของพร้อมส่งครับ' });

    expect((await eraseAccount(buyer)).status).toBe(204);

    const history = await emitAck<{ items: { senderId: string; content: string; fileId: string | null }[] }>(sellerSocket, 'listMessages', { roomId });
    sellerSocket.disconnect();
    const contents = history.ok ? history.data.items.map((m) => m.content) : [];
    expect(contents.join(' ')).not.toContain('99/9');
    expect(contents).toContain('มีของพร้อมส่งครับ'); // untouched, byte for byte
    // The picture the buyer sent: the message row still names it, the bytes are gone (K1).
    expect((await seller.get(`${API}/chat-rooms/${roomId}/attachments/${sentPicture}`)).status).toBe(404);
    // The picture they uploaded and never sent: the pending row and its bytes both gone.
    expect(await app.prisma.chatPendingAttachment.count()).toBe(0);
    expect(await app.prisma.uploadedFile.findUnique({ where: { id: unsentPicture } })).toBeNull();
    expect(await app.prisma.chatRoom.count()).toBe(1); // the room itself is never deleted
  });

  it('🚨 §89: every earlier version of an edited message is overwritten too — the other party can no longer read the old text', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const buyerSocket = await connectedChatSocket(app, buyer);
    const room = await emitAck<{ id: string }>(buyerSocket, 'openRoomWithShop', { shopId });
    const roomId = room.ok ? room.data.id : '';
    const sent = await emitAck<{ id: string }>(buyerSocket, 'sendMessage', { roomId, content: 'เบอร์ผม 0812345678 ครับ' });
    const messageId = sent.ok ? sent.data.id : '';
    await emitAck(buyerSocket, 'editMessage', { roomId, messageId, content: 'โทรหาผมได้เลยครับ' });
    buyerSocket.disconnect();

    expect((await eraseAccount(buyer)).status).toBe(204);

    const sellerSocket = await connectedChatSocket(app, seller);
    const versions = await emitAck<{ items: { content: string }[] }>(sellerSocket, 'listMessageVersions', { roomId, messageId });
    sellerSocket.disconnect();
    const contents = versions.ok ? versions.data.items.map((v) => v.content) : ['(no ack)'];
    expect(contents.length).toBeGreaterThan(0);
    expect(contents.join(' ')).not.toContain('0812345678');
    expect(new Set(contents)).toEqual(new Set([ERASED_CHAT_MESSAGE_PLACEHOLDER]));
  });
});

describe('#70 (K16) — the marker written here is exactly what #29’s registration guard reads', () => {
  // #74 closed the gap this comment used to describe: `wasBanned: true` had no reachable trigger
  // through the self-service-only endpoint (`AuthGuard` refuses a banned account's cookie "even
  // on a public route", including `GET /auth/csrf` — see that guard's own comment), which #70
  // left honestly untested and DECISIONS.md flagged as an open question rather than a gap in
  // coverage. `POST /admin/users/:userId/erase` (#74) is the door the project owner chose to add
  // instead of loosening `AuthGuard` — see the describe block below this one for its own tests,
  // and `wasBanned: true` proven reachable for the first time right here.

  it('a super admin erasing a banned account writes wasBanned: true to the marker', async () => {
    const app = getApp();
    const { superAdmin, buyerId } = await completedOrderScenario(app);
    await ban(superAdmin, buyerId);

    const response = await superAdmin
      .post(`${API}/admin/users/${buyerId}/erase`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: ERASE_REASON });
    expect(response.status).toBe(204);

    const markers = await app.prisma.deletedAccountMarker.findMany();
    expect(markers).toHaveLength(1);
    expect(markers[0]?.wasBanned).toBe(true);
  });

  it('lets someone who was erased but never banned register again — a fresh account, no history carried over', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(app, seller, order.id);
    await markReceived(buyer, order.id);

    await eraseAccount(buyer);

    const fresh = newClient(app);
    const registered = await fresh
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(fresh))
      .send({
        email: BUYER,
        password: 'Passw0rd!23',
        ...CURRENT_ACCEPTANCES,
      });
    expect(registered.status).toBe(202);

    const newRow = await app.prisma.user.findFirstOrThrow({ where: { email: BUYER } });
    expect(newRow.disputeLostCount).toBe(0); // K16: not carried back over, a real fresh start
  });

  it('records no PII in the marker itself — only a digest, computed the same way #29’s reader does', async () => {
    const app = getApp();
    const { buyer } = await completedOrderScenario(app);
    // The digest has to be taken *before* erasure changes what `AccountMarkerService.hash` would
    // even compute from this account's row — the real email, same as #29's own reader uses.
    const expectedHmac = app.app.get(AccountMarkerService).hash(BUYER);

    await eraseAccount(buyer);

    const markers = await app.prisma.deletedAccountMarker.findMany();
    expect(markers).toHaveLength(1);
    expect(JSON.stringify(markers)).not.toContain(BUYER);
    expect(markers[0]?.emailHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(markers[0]?.emailHmac).toBe(expectedHmac);
    expect(markers[0]?.wasBanned).toBe(false);
  });
});

describe('#74 (K16, §57/§60) — admin-assisted erasure for a banned account', () => {
  it('refuses an ordinary signed-in user (not a super admin)', async () => {
    const app = getApp();
    const { buyerId } = await completedOrderScenario(app);
    const somchai = newClient(app);
    await registerAndLogin(somchai, 'somchai@example.test');

    const response = await somchai
      .post(`${API}/admin/users/${buyerId}/erase`)
      .set(CSRF_HEADER, await csrfToken(somchai))
      .send({ reason: ERASE_REASON });

    expect(response.status).toBe(403);
  });

  it('refuses somebody who is not signed in at all', async () => {
    const app = getApp();
    const { buyerId } = await completedOrderScenario(app);

    const response = await newClient(app).post(`${API}/admin/users/${buyerId}/erase`);

    expect(response.status).toBe(401);
  });

  it('refuses an account that is not banned — self-service exists for that', async () => {
    const app = getApp();
    const { superAdmin, buyerId } = await completedOrderScenario(app);

    const response = await superAdmin
      .post(`${API}/admin/users/${buyerId}/erase`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: ERASE_REASON });

    expect(response.status).toBe(409);
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).toBeNull();
  });

  it('answers 404 for an account id that does not exist', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);

    const response = await superAdmin
      .post(`${API}/admin/users/${newId()}/erase`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: ERASE_REASON });

    expect(response.status).toBe(404);
  });

  it('erases immediately (204) when nothing is pending, and audit_log names the super admin as actor — not the target', async () => {
    const app = getApp();
    const { superAdmin, buyerId } = await completedOrderScenario(app);
    const adminId = (await app.prisma.user.findUniqueOrThrow({ where: { email: SUPER } })).id;
    await ban(superAdmin, buyerId);

    const response = await superAdmin
      .post(`${API}/admin/users/${buyerId}/erase`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: ERASE_REASON });

    expect(response.status).toBe(204);
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    expect(row.erasedAt).not.toBeNull();

    const entry = await app.prisma.auditLog.findFirstOrThrow({
      where: { action: 'ACCOUNT_ERASED', targetId: buyerId },
    });
    expect(entry.actorUserId).toBe(adminId); // the super admin who called this, not buyerId itself
  });

  it('queues (202) instead of refusing when a non-terminal order is still in flight — same H9 flow as self-service', async () => {
    const app = getApp();
    const { superAdmin, buyerId } = await completedOrderScenario(app);
    void buyerId; // this scenario needs its own second buyer with an order still open

    const communityId = await createCommunity(superAdmin, 'ชุมชนที่สอง');
    const categoryId = await createCategory(superAdmin, 'ของใช้');
    const { seller } = await sellerWithShop(app, 'seller2@example.test', communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบคิว', 10000, 5);
    const secondBuyer = newClient(app);
    const secondBuyerId = await registerVerified(app, secondBuyer, 'buyer2@example.test');
    const address = await createAddress(app, secondBuyer);
    await placeOrder(secondBuyer, address.id, product.variants[0]!.id); // AWAITING_SHIPPING_QUOTE — non-terminal
    await ban(superAdmin, secondBuyerId);

    const response = await superAdmin
      .post(`${API}/admin/users/${secondBuyerId}/erase`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ reason: ERASE_REASON });

    expect(response.status).toBe(202);
    const body = response.body as { blockers: { role: string }[] };
    expect(body.blockers).toHaveLength(1);
    expect(body.blockers[0]?.role).toBe('BUYER');
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: secondBuyerId } });
    expect(row.erasedAt).toBeNull();
    expect(row.erasureRequestedAt).not.toBeNull();
  });

  it('§86: a banned owner’s open shop is closed by the erasure itself — the owner cannot sign in to close it', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const { shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
    await ban(superAdmin, sellerId);

    const response = await eraseAsAdmin(superAdmin, sellerId);

    expect(response.status).toBe(204);
    const shop = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop.closedAt).not.toBeNull();
    const superId = (await app.prisma.user.findUniqueOrThrow({ where: { email: SUPER } })).id;
    const closed = await app.prisma.auditLog.findFirstOrThrow({
      where: { action: 'SHOP_CLOSED', targetId: shopId },
    });
    expect(closed).toMatchObject({ actorUserId: superId, communityId });
  });

  it('§86: an open shop that still has orders to settle is not closed — 409 names each order, the same way closing it yourself would', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId, sellerId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await ban(superAdmin, sellerId); // freezes the order — a frozen order blocks closing (I11)

    const response = await eraseAsAdmin(superAdmin, sellerId);

    expect(response.status).toBe(409);
    expect(
      Object.keys((response.body as { fieldErrors: Record<string, string> }).fieldErrors),
    ).toEqual([order.id]);
    expect(
      (await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).closedAt,
    ).toBeNull();
  });

  it('§86: an admin erasure needs a reason, and is audited even when it only queues', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 10000, 5);
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    await placeOrder(buyer, address.id, product.variants[0]!.id);
    await ban(superAdmin, buyerId);

    const noReason = await superAdmin
      .post(`${API}/admin/users/${buyerId}/erase`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({});
    expect(noReason.status).toBe(400);

    const queued = await eraseAsAdmin(superAdmin, buyerId);

    expect(queued.status).toBe(202);
    const superId = (await app.prisma.user.findUniqueOrThrow({ where: { email: SUPER } })).id;
    const entry = await app.prisma.auditLog.findFirstOrThrow({
      where: { action: 'ACCOUNT_ERASURE_REQUESTED', targetId: buyerId },
    });
    expect(entry).toMatchObject({ actorUserId: superId, reason: ERASE_REASON });
  });

  it('does not touch AuthGuard — a banned account still cannot reach the self-service endpoint at all, not even GET /auth/csrf', async () => {
    const app = getApp();
    const { superAdmin, buyer, buyerId } = await completedOrderScenario(app);
    await ban(superAdmin, buyerId);

    // The precondition of #74's own reason to exist. Sent with no x-csrf-token at all, which
    // would normally fail CSRF first: AuthGuard's APP_GUARD ordering runs ahead of CsrfGuard (see
    // AuthModule's comment on guard order), so the refusal names the ban rather than the header.
    // A banned account cannot mint a session-bound CSRF token either — GET /auth/csrf is refused
    // by this same check — so there is no shape of this request that gets through.
    const eraseResponse = await buyer.post(`${API}/auth/account/erase`);
    expect(eraseResponse.status).toBe(403);
    expect((eraseResponse.body as ErrorBody).code).toBe('ACCOUNT_BANNED');

    // And a second attempt from the same browser is not even a banned account any more: that
    // first refusal took the session cookies back with it, so that a banned person can still
    // reach the public shopfront (invariant 1 — see banning.spec.ts). The endpoint stays shut
    // either way, which is the precondition #74's admin-assisted route exists to work around.
    const afterCookiesTaken = await buyer.post(`${API}/auth/account/erase`);
    expect(afterCookiesTaken.status).toBe(401);
    expect((afterCookiesTaken.body as ErrorBody).code).toBe('UNAUTHENTICATED');
  });
});

describe('#70 — a canary for PII-shaped columns nobody wired into erasure', () => {
  /**
   * Every (table, column) pair already known to be PII and already handled by
   * `AccountErasureService`, or explicitly deferred with a reason. Grows only by a deliberate
   * edit here — the AC's own "เขียนเทสต์ที่ช่วยจับของที่ลืม" (#70's Further Notes), so a future
   * table that copies a name/phone/bank-account-shaped column without updating both this list
   * and the erasure service fails a test instead of shipping quietly.
   *
   * Deliberately not a bare `name` match (that would flag `product.name`, `category.name`,
   * `shipping_carrier.name`, `community.name`, every reference-geography `name_th` — none of
   * which is personal data) — the pattern below is the exact shape PII columns in this schema
   * have taken so far, not a generic word list.
   */
  const KNOWN_PII_COLUMNS = new Set([
    'user.email',
    'user.password_hash',
    'address.recipient_name',
    'address.phone',
    'address.house_number',
    'address.village_number',
    'address.alley',
    'address.road',
    'order.recipient_name',
    'order.phone',
    'order.house_number',
    'order.village_number',
    'order.alley',
    'order.road',
    'order.subdistrict_name',
    'order.district_name',
    'order.province_name',
    'order.postal_code',
    'order.refund_bank_name',
    'order.refund_bank_account_number',
    'order.refund_bank_account_name',
    'order.refund_prompt_pay_id',
    'payment_channel.bank_name',
    'payment_channel.bank_account_number',
    'payment_channel.bank_account_name',
    'payment_channel.prompt_pay_id',
    // N4 (#71): the shop's own name — overwritten by `AccountErasureService`, same as every
    // other PII-shaped column in this list. Kept here rather than removed, because the pattern
    // below would otherwise flag it as unaccounted for.
    'shop.name',
    // #46: government reference geography data (province → district → subdistrict → postal
    // code), seeded once and never user-supplied — nobody's own postal code, so not PII at all.
    'subdistrict_postal_code.postal_code',
  ]);

  const PII_SHAPED_COLUMN = /(^|_)(email|phone|bank_name|bank_account_number|bank_account_name|prompt_pay_id|recipient_name|house_number|village_number|alley|road|subdistrict_name|district_name|province_name|postal_code|password_hash)$/;

  it('every column shaped like a known PII pattern is either handled here or deliberately deferred', async () => {
    const app = getApp();
    const columns = await app.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
    `;

    const unaccounted = columns
      .filter((row) => PII_SHAPED_COLUMN.test(row.column_name))
      .map((row) => `${row.table_name}.${row.column_name}`)
      .filter((key) => !KNOWN_PII_COLUMNS.has(key));

    expect(unaccounted).toEqual([]);
  });
});

describe('code review of topic 12 (§84)', () => {
  it('🚨 an email that was erased once can be erased again — the marker is merged, never a 500', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const first = newClient(app);
    await registerVerified(app, first, 'twice@example.test');
    expect((await eraseAccount(first)).status).toBe(204);

    // K16: never banned, so the same address may sign up again — and this second account is banned.
    const second = newClient(app);
    const secondId = await registerVerified(app, second, 'twice@example.test');
    expect((await ban(superAdmin, secondId)).status).toBe(204);

    const again = await eraseAsAdmin(superAdmin, secondId);

    expect(again.status).toBe(204);
    const markers = await app.prisma.deletedAccountMarker.findMany();
    expect(markers).toHaveLength(1);
    expect(markers[0]?.wasBanned).toBe(true); // either account ever banned → the address stays barred
    const retry = newClient(app);
    await retry
      .post(`${API}/auth/register`)
      .set(CSRF_HEADER, await csrfToken(retry))
      .send({ email: 'twice@example.test', password: 'a-long-enough-passphrase', ...CURRENT_ACCEPTANCES });
    expect(await app.prisma.user.count({ where: { email: 'twice@example.test' } })).toBe(0); // K16: refused, silently
  });

  it('🚨 one queued account failing never stops the sweep from clearing the others', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนคิว');
    const categoryId = await createCategory(superAdmin, 'หมวด');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของในคิว', 1000, 5);
    for (const email of ['queued-a@example.test', 'queued-b@example.test']) {
      const buyer = newClient(app);
      await registerVerified(app, buyer, email);
      const address = await createAddress(app, buyer);
      await placeOrder(buyer, address.id, product.variants[0]!.id);
      expect((await eraseAccount(buyer)).status).toBe(202); // AWAITING_SHIPPING_QUOTE blocks
    }

    // Whichever queued account the sweep tries first fails on every pass, however it fails.
    const shops = app.prisma.shop;
    const realFindFirst = shops.findFirst.bind(shops);
    let failingOwnerId: unknown;
    vi.spyOn(shops, 'findFirst').mockImplementation(((args: Parameters<typeof realFindFirst>[0]) => {
      const ownerId: unknown = args?.where?.ownerId;
      if (ownerId !== undefined) {
        failingOwnerId ??= ownerId;
        if (ownerId === failingOwnerId) {
          return Promise.reject(new Error('simulated failure for one queued account'));
        }
      }
      return realFindFirst(args);
    }) as unknown as typeof shops.findFirst);

    // Clock 1 runs out → both orders CANCELLED → both requests clearable. Two passes, because the
    // order-expiry task and the queue task are not guaranteed to run in that order within one.
    app.clock.advanceByHours(25);
    await app.sweep.run();
    await app.sweep.run();

    expect(failingOwnerId).toBeDefined();
    expect(await app.prisma.user.count({ where: { erasureRequestedAt: { not: null }, erasedAt: { not: null } } })).toBe(1);
  });

  it('🚨 one file that fails to delete does not leave the others on disk', async () => {
    const app = getApp();
    const { buyer, order } = await completedOrderScenario(app);
    await writeReview(buyer, order.id, 5, 'ของดี');
    const reviewed = await buyer.post(`${API}/orders/${order.id}/review/images`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await aJpegBuffer(), 'r.jpg');
    const review = reviewed.body as { id: string; images: { id: string }[] };
    const storage = app.app.get(FileStorageService);
    const realDelete = storage.deleteBytes.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'deleteBytes').mockImplementation((id: string) => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('EIO: simulated disk error')) : realDelete(id);
    });

    const response = await eraseAccount(buyer);

    expect(response.status).toBe(204);
    expect(calls).toBeGreaterThanOrEqual(2);
    // The slip was first in line and failed; the review picture after it still went.
    expect((await newClient(app).get(`${API}/reviews/${review.id}/images/${review.images[0]!.id}`)).status).toBe(404);
  });

  it('🚨 an erased account’s sessions stop working even if revoking them never ran (a crash right after commit)', async () => {
    const app = getApp();
    const { buyer } = await completedOrderScenario(app);
    const otherDevice = newClient(app);
    await login(otherDevice, BUYER);
    vi.spyOn(app.app.get(SessionService), 'revokeAllForUser').mockResolvedValue(0);

    expect((await eraseAccount(buyer)).status).toBe(204);

    expect((await otherDevice.get(`${API}/addresses`)).status).toBe(401);
  });

  it('🚨 review pictures are deleted (G3/K10/K1); the review itself stays', async () => {
    const app = getApp();
    const { buyer, shopId, order } = await completedOrderScenario(app);
    await writeReview(buyer, order.id, 4, 'ส่งไว ของตรงปก');
    const reviewed = await buyer.post(`${API}/orders/${order.id}/review/images`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await aJpegBuffer(), 'r.jpg');
    const review = reviewed.body as { id: string; images: { id: string }[] };
    const stranger = newClient(app);
    expect((await stranger.get(`${API}/reviews/${review.id}/images/${review.images[0]!.id}`)).status).toBe(200);

    expect((await eraseAccount(buyer)).status).toBe(204);

    expect((await stranger.get(`${API}/reviews/${review.id}/images/${review.images[0]!.id}`)).status).toBe(404);
    const reviews = await stranger.get(`${API}/shops/${shopId}/reviews`);
    expect((reviews.body as { items: { id: string; rating: number }[] }).items.map((r) => r.rating)).toEqual([4]); // K15: the review stays
  });

  it('🚨 a dispute keeps its ruling, but each erased party’s own words and evidence files go (K1 · §84 owner’s choice)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนข้อพิพาท');
    const categoryId = await createCategory(superAdmin, 'หมวด');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของมีปัญหา', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(app, seller, order.id);
    const opened = await buyer
      .post(`${API}/orders/${order.id}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'ได้ของผิดสี โทรหาผมที่ 0812345678 ได้เลยครับ')
      .attach('files', await aJpegBuffer(), 'evidence.jpg');
    expect(opened.status).toBe(201);
    const disputeId = (opened.body as { id: string }).id;
    await seller
      .post(`${API}/shops/me/orders/${order.id}/dispute/respond`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .field('response', 'ส่งตรงตามสั่ง ติดต่อป้าสมศรีเจ้าของร้านได้')
      .attach('files', await aJpegBuffer(), 'response.jpg');
    const ruled = await superAdmin
      .post(`${API}/disputes/${disputeId}/ruling`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ verdict: 'SHOP_WINS', reason: 'หลักฐานของร้านชัดเจนว่าส่งสินค้าตรงตามที่ผู้ซื้อสั่งไว้ทุกประการ' });
    expect(ruled.status).toBe(200);
    const evidence = await app.prisma.disputeEvidence.findMany({ orderBy: { createdAt: 'asc' } });
    expect(evidence).toHaveLength(2);

    // H10: past 15 days after shippedAt the SHIPPED order no longer blocks either side.
    app.clock.advanceByDays(16);
    await login(buyer, BUYER);
    expect((await eraseAccount(buyer)).status).toBe(204);
    await login(seller, SELLER);
    await closeShop(seller, shopId);
    expect((await eraseAccount(seller)).status).toBe(204);

    const dispute = await app.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    expect(dispute.reason).not.toContain('0812345678');
    expect(dispute.shopResponse).not.toContain('ป้าสมศรี');
    expect(dispute.rulingReason).toBe('หลักฐานของร้านชัดเจนว่าส่งสินค้าตรงตามที่ผู้ซื้อสั่งไว้ทุกประการ'); // G3: the ruling stays
    await login(superAdmin, SUPER);
    for (const item of evidence) {
      const read = await superAdmin.get(`${API}/disputes/${disputeId}/admin-evidence/${item.id}`);
      expect(read.status).toBe(404);
    }
  });

  it('🚨 an order placed while the erasure is being decided is never overwritten — the request queues instead', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนแข่ง');
    const categoryId = await createCategory(superAdmin, 'หมวด');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของแข่ง', 1000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    // Place a real order the moment the erasure has finished looking for blockers and found none.
    const orders = app.prisma.order;
    const realFindMany = orders.findMany.bind(orders);
    let placed = false;
    vi.spyOn(orders, 'findMany').mockImplementation((async (args: Parameters<typeof realFindMany>[0]) => {
      const result = await realFindMany(args);
      if (!placed) {
        placed = true;
        await placeOrder(buyer, address.id, product.variants[0]!.id);
      }
      return result;
    }) as unknown as typeof orders.findMany);

    const response = await eraseAccount(buyer);

    expect(placed).toBe(true);
    expect(response.status).toBe(202);
    const order = await app.prisma.order.findFirstOrThrow();
    expect(order.status).toBe('AWAITING_SHIPPING_QUOTE');
    expect(order.recipientName).toBe(address.recipientName); // snapshot intact — the shop can still ship
    expect((await app.prisma.user.findFirstOrThrow({ where: { id: order.buyerId } })).erasedAt).toBeNull();
  });

  it('a queued request stuck on a shop the person opened afterwards says so (H9: "บอกเหตุผล")', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนสถานะ');
    const categoryId = await createCategory(superAdmin, 'หมวด');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของสถานะ', 1000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    await placeOrder(buyer, address.id, product.variants[0]!.id);
    expect((await eraseAccount(buyer)).status).toBe(202);
    await buyer.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(buyer)).send({ communityId, name: 'ร้านใหม่ของผู้ซื้อ' });
    app.clock.advanceByHours(25);
    await app.sweep.run(); // the order times out — only the new shop is left in the way
    await login(buyer, BUYER);

    const status = await buyer.get(`${API}/auth/account/erasure-status`);

    expect(status.status).toBe(200);
    const body = status.body as { status: string; blockers: unknown[]; blockedByOpenShop: boolean };
    expect(body.status).toBe('QUEUED');
    expect(body.blockers).toEqual([]);
    expect(body.blockedByOpenShop).toBe(true);
  });
});

/**
 * §94/§96: the gaps the scrutiny of §94 found in erasure, each shown failing on the code before
 * §96. An open dispute — on any order, finished or not — and, for a seller, a finished order the
 * buyer can still open one on, hold the request in the queue (§84: nobody would be left to answer
 * it or pay back); an unban mid-request stops an admin's erasure (§87); nothing the buyer writes
 * while their erasure runs outlives it; and the buyer's own free text and refund-slip pictures go
 * with the rest (§94, owner's decisions).
 */
describe('§96 — erasure waits for disputes, and leaves nothing of the buyer behind', () => {
  async function openDispute(buyer: Agent, orderId: string) {
    return buyer
      .post(`${API}/orders/${orderId}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'ของที่ได้รับไม่ตรงกับที่สั่งเลย ขอคืนเงิน')
      .attach('files', await aJpegBuffer(), 'evidence.jpg');
  }

  interface StatusBody {
    status: string;
    blockers: { orderId: string; role: string; reason: string; clearsAt: string | null }[];
  }

  it('a buyer with an open dispute on a COMPLETED order is queued, not erased — and erased once the dispute is ruled', async () => {
    const app = getApp();
    const { superAdmin, buyer, order } = await completedOrderScenario(app);
    const dispute = (await openDispute(buyer, order.id)).body as { id: string };

    const erased = await eraseAccount(buyer);

    expect(erased.status).toBe(202);
    const status = (await buyer.get(`${API}/auth/account/erasure-status`)).body as StatusBody;
    expect(status.blockers).toEqual([{ orderId: order.id, role: 'BUYER', status: 'COMPLETED', reason: 'OPEN_DISPUTE', clearsAt: null }]);
    // The evidence is still there for the admin to rule on.
    const evidence = (await buyer.get(`${API}/orders/${order.id}/dispute`)).body as { evidence: { id: string }[] }[];
    expect(evidence[0]!.evidence).toHaveLength(1);

    expect(
      (await superAdmin
        .post(`${API}/disputes/${dispute.id}/ruling`)
        .set(CSRF_HEADER, await csrfToken(superAdmin))
        .send({ verdict: 'SHOP_WINS', reason: 'ตรวจหลักฐานแล้ว ร้านส่งของตรงตามที่ตกลงไว้ จึงให้ร้านเป็นฝ่ายถูก' })).status,
    ).toBe(200);
    await app.sweep.run();
    expect((await login(newClient(app), BUYER)).status).toBe(401);
  });

  it('a seller whose closed shop has a COMPLETED order still inside its dispute window is queued until the window ends', async () => {
    const app = getApp();
    const { seller, shopId, order } = await completedOrderScenario(app);
    expect((await closeShop(seller, shopId)).status).toBe(200);

    const erased = await eraseAccount(seller);

    expect(erased.status).toBe(202);
    const status = (await seller.get(`${API}/auth/account/erasure-status`)).body as StatusBody;
    expect(status.blockers).toHaveLength(1);
    expect(status.blockers[0]).toMatchObject({ orderId: order.id, role: 'SELLER', reason: 'DISPUTE_WINDOW' });
    expect(status.blockers[0]!.clearsAt).not.toBeNull();

    app.clock.advanceByDays(6);
    await app.sweep.run();
    expect((await login(newClient(app), SELLER)).status).toBe(200); // still inside the 7 days

    app.clock.advanceByDays(2);
    await app.sweep.run();
    expect((await login(newClient(app), SELLER)).status).toBe(401); // window over → erased by the sweep
  });

  it('a seller whose closed shop has an open dispute on a COMPLETED order is queued', async () => {
    const app = getApp();
    const { buyer, seller, shopId, order } = await completedOrderScenario(app);
    expect((await closeShop(seller, shopId)).status).toBe(200);
    expect((await openDispute(buyer, order.id)).status).toBe(201);

    expect((await eraseAccount(seller)).status).toBe(202);
    const status = (await seller.get(`${API}/auth/account/erasure-status`)).body as StatusBody;
    expect(status.blockers[0]).toMatchObject({ orderId: order.id, role: 'SELLER', reason: 'OPEN_DISPUTE', clearsAt: null });
  });

  it('an unban landing while a super admin’s erasure is in progress stops it — the account is neither erased nor queued', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const victim = newClient(app);
    const victimId = await registerVerified(app, victim, BUYER);
    expect((await ban(superAdmin, victimId)).status).toBe(204);
    const shops = app.app.get(ShopService);
    const original = shops.closeForErasure.bind(shops);
    let unbanned = 0;
    vi.spyOn(shops, 'closeForErasure').mockImplementationOnce(async (...args) => {
      unbanned = (await superAdmin.post(`${API}/admin/users/${victimId}/unban`).set(CSRF_HEADER, await csrfToken(superAdmin))).status;
      return original(...args);
    });

    const erased = await eraseAsAdmin(superAdmin, victimId);

    expect(unbanned).toBe(204);
    expect(erased.status).toBe(409);
    await login(victim, BUYER);
    expect(((await victim.get(`${API}/auth/account/erasure-status`)).body as StatusBody).status).toBe('NONE');
  });

  it('a review photo still uploading when the buyer’s erasure commits is refused, and never served', async () => {
    const app = getApp();
    const { buyer, order, shopId } = await completedOrderScenario(app);
    const review = (await writeReview(buyer, order.id, 5, 'ส่งไวมาก ของดี')).body as { id: string };
    const files = app.app.get(FileStorageService);
    const original = files.storeImage.bind(files);
    let erasedStatus = 0;
    vi.spyOn(files, 'storeImage').mockImplementationOnce(async (...args) => {
      const stored = await original(...args);
      erasedStatus = (await eraseAccount(buyer)).status;
      return stored;
    });

    const uploaded = await buyer
      .post(`${API}/orders/${order.id}/review/images`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', await aJpegBuffer(), 'photo.jpg');

    expect(erasedStatus).toBe(204);
    expect(uploaded.status).toBe(401);
    const listed = (await newClient(app).get(`${API}/shops/${shopId}/reviews`)).body as { items: { id: string; images: unknown[] }[] };
    expect(listed.items.find((item) => item.id === review.id)?.images).toEqual([]);
  });

  it('a review being written when the buyer’s erasure commits is refused — its text never appears', async () => {
    const app = getApp();
    const { buyer, order, shopId } = await completedOrderScenario(app);
    const original = app.prisma.order.findFirst.bind(app.prisma.order) as (...args: unknown[]) => Promise<unknown>;
    let erasedStatus = 0;
    vi.spyOn(app.prisma.order, 'findFirst').mockImplementationOnce((async (...args: unknown[]) => {
      const found = await original(...args);
      erasedStatus = (await eraseAccount(buyer)).status;
      return found;
    }) as never);

    const written = await writeReview(buyer, order.id, 1, 'ร้านนี้ชื่อจริงนายสมชาย โทร 0812345678');

    expect(erasedStatus).toBe(204);
    expect(written.status).toBe(401);
    const listed = (await newClient(app).get(`${API}/shops/${shopId}/reviews`)).body as { items: { text: string | null }[] };
    expect(listed.items.map((item) => item.text)).not.toContain('ร้านนี้ชื่อจริงนายสมชาย โทร 0812345678');
  });

  it('a password-reset link sent before the erasure no longer works after it', async () => {
    const app = getApp();
    const user = newClient(app);
    await registerVerified(app, user, BUYER);
    app.email.clear();
    expect((await forgotPassword(newClient(app), BUYER)).status).toBe(202);
    const token = linkTokenFrom(app.email.ofKind('PASSWORD_RESET').at(-1)!.body);
    expect((await eraseAccount(user)).status).toBe(204);

    const reset = await resetPassword(newClient(app), token, 'a-completely-different-passphrase');

    expect(reset.status).toBe(400);
    expect((reset.body as ErrorBody).code).toBe('RESET_LINK_INVALID');
  });

  it('erasing a buyer deletes the pictures of the refund slips the shop sent them (their bank details are on it) — the rows stay', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบคืนเงิน', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    await uploadPaymentSlip(buyer, order.id);
    app.clock.advanceByDays(3);
    await app.sweep.run(); // clock 3 runs out → REFUND_ORDERED
    await login(buyer, BUYER);
    await login(seller, SELLER);
    const slip = (await seller
      .post(`${API}/shops/me/orders/${order.id}/refund-slips`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', await aJpegBuffer(), 'refund.jpg')).body as { id: string };
    expect((await buyer.post(`${API}/orders/${order.id}/refund-received`).set(CSRF_HEADER, await csrfToken(buyer))).status).toBe(200);

    expect((await eraseAccount(buyer)).status).toBe(204);

    const listed = (await seller.get(`${API}/orders/${order.id}/refund-slips`)).body as { id: string }[];
    expect(listed.map((row) => row.id)).toEqual([slip.id]);
    expect((await seller.get(`${API}/orders/${order.id}/refund-slips/${slip.id}/file`)).status).toBe(404);
  });

  it('erasing a buyer overwrites the words they typed: review text, their cancel reason, and their reason for rejecting a shipping fee', async () => {
    const app = getApp();
    const { seller, buyer, order, shopId, addressId } = await completedOrderScenario(app);
    const REVIEW_TEXT = 'คนส่งชื่อสมชาย บ้านเลขที่ 99/9 ส่งช้ามาก';
    const CANCEL_REASON = 'เปลี่ยนใจแล้ว ติดต่อผมที่ 0812345678';
    const REJECT_REASON = 'ค่าส่งแพงเกินไป โทรคุยกับผมที่ 0899999999 ได้';
    expect((await writeReview(buyer, order.id, 4, REVIEW_TEXT)).status).toBe(201);

    // The scenario's one product, read through the public listing.
    const listing = (await newClient(app).get(`${API}/products`)).body as { items: { id: string }[] };
    const variantId = ((await newClient(app).get(`${API}/products/${listing.items[0]!.id}`)).body as ProductBody).variants[0]!.id;
    const toCancel = await placeOrder(buyer, addressId, variantId);
    expect((await buyer.post(`${API}/orders/${toCancel.id}/cancel`).set(CSRF_HEADER, await csrfToken(buyer)).send({ reason: CANCEL_REASON })).status).toBe(200);
    const toReject = await placeOrder(buyer, addressId, variantId);
    await setShippingFee(seller, toReject.id, 99900);
    expect((await buyer.post(`${API}/orders/${toReject.id}/reject-shipping-fee`).set(CSRF_HEADER, await csrfToken(buyer)).send({ reason: REJECT_REASON })).status).toBe(200);

    expect((await eraseAccount(buyer)).status).toBe(204);

    const reviews = (await newClient(app).get(`${API}/shops/${shopId}/reviews`)).body as { items: { text: string | null; rating: number }[] };
    expect(reviews.items).toHaveLength(1);
    expect(reviews.items[0]!.rating).toBe(4); // the review and its stars stay
    expect(reviews.items[0]!.text).toBe(ERASED_BUYER_TEXT_PLACEHOLDER);
    const shopOrders = (await seller.get(`${API}/shops/me/orders`)).body as { items: { id: string; cancelReason: string | null }[] };
    expect(shopOrders.items.find((item) => item.id === toCancel.id)?.cancelReason).toBe(ERASED_BUYER_TEXT_PLACEHOLDER);
    // No endpoint returns a shipping-fee rejection's reason — the row is the only place it lives.
    const rejection = await app.prisma.shippingFeeRejection.findUniqueOrThrow({ where: { orderId: toReject.id } });
    expect(rejection.reason).toBe(ERASED_BUYER_TEXT_PLACEHOLDER);
  });

  it('a dispute opened across the end of its window is judged at the moment it is written, not when the evidence started uploading', async () => {
    const app = getApp();
    const { buyer, seller, shopId, order } = await completedOrderScenario(app);
    expect((await closeShop(seller, shopId)).status).toBe(200);
    app.clock.advanceByDays(7); // exactly the last instant of the 7 days after "received"
    await login(buyer, BUYER);
    await login(seller, SELLER);
    const files = app.app.get(FileStorageService);
    // A dispute's evidence is stored in one batch under one processing slot (§100).
    const original = files.storeImages.bind(files);
    let sellerErased = 0;
    vi.spyOn(files, 'storeImages').mockImplementationOnce(async (...args) => {
      const stored = await original(...args);
      app.clock.advanceBy(1000); // the re-encode outlives the window
      sellerErased = (await eraseAccount(seller)).status; // nothing blocks the seller any more
      return stored;
    });

    const opened = await openDispute(buyer, order.id);

    expect(sellerErased).toBe(204);
    expect(opened.status).toBe(409);
  });

  it('a seller’s erasure waits for a dispute being opened on their order, and is then queued on it', async () => {
    const app = getApp();
    const { buyer, seller, shopId, order } = await completedOrderScenario(app);
    expect((await closeShop(seller, shopId)).status).toBe(200);
    app.clock.advanceByDays(7);
    await login(buyer, BUYER);
    await login(seller, SELLER);
    let erasing: Promise<{ status: number }> | undefined;
    // Query 1 locks the buyer, 2 the shop owner, 3 the order — by then the window has been judged
    // (still open). The seller's erasure starts one second later, when the window is over for it.
    pauseNextTransactionAfterRawQuery(app, 3, async () => {
      app.clock.advanceBy(1000);
      erasing = eraseAccount(seller).then((response) => response);
      await untilSomeoneWaitsOnALock(app);
    });

    const opened = await openDispute(buyer, order.id);

    expect(opened.status).toBe(201);
    expect((await erasing!).status).toBe(202);
    const status = (await seller.get(`${API}/auth/account/erasure-status`)).body as StatusBody;
    expect(status.blockers).toEqual([{ orderId: order.id, role: 'SELLER', status: 'COMPLETED', reason: 'OPEN_DISPUTE', clearsAt: null }]);
  });

  it('a seller is queued through the last instant a buyer could still dispute a cancelled order they had paid for, and erased right after', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบยกเลิก', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const address = await createAddress(app, buyer);
    const order = await placeOrder(buyer, address.id, product.variants[0]!.id);
    await setShippingFee(seller, order.id, 2000);
    const slip = await uploadPaymentSlip(buyer, order.id);
    expect((await seller
      .post(`${API}/shops/me/orders/${order.id}/payment-slips/${slip.id}/reject`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({ reason: 'ยอดโอนไม่ตรงกับยอดที่ต้องชำระ กรุณาตรวจสอบและโอนใหม่' })).status).toBe(200);
    app.clock.advanceByDays(5);
    await app.sweep.run(); // clock 2 runs out after the rejection → CANCELLED, with a slip on it
    await login(seller, SELLER);
    const cancelled = (await seller.get(`${API}/orders/${order.id}`)).body as { status: string; disputeDeadline: string };
    expect(cancelled.status).toBe('CANCELLED');
    expect((await closeShop(seller, shopId)).status).toBe(200);

    expect((await eraseAccount(seller)).status).toBe(202);
    const status = (await seller.get(`${API}/auth/account/erasure-status`)).body as StatusBody;
    // The same deadline the order itself shows (§85: 15 days from the cancellation).
    expect(status.blockers).toEqual([{ orderId: order.id, role: 'SELLER', status: 'CANCELLED', reason: 'DISPUTE_WINDOW', clearsAt: cancelled.disputeDeadline }]);
    const windowEnds = new Date(cancelled.disputeDeadline).getTime();

    app.clock.advanceBy(windowEnds - app.clock.now().getTime());
    await app.sweep.run();
    expect((await login(newClient(app), SELLER)).status).toBe(200); // the buyer can still open one this instant

    app.clock.advanceBy(1000);
    await app.sweep.run();
    expect((await login(newClient(app), SELLER)).status).toBe(401);
  });

  it('a review edit landing while the buyer’s erasure commits is refused — the old words do not come back', async () => {
    const app = getApp();
    const { buyer, order, shopId } = await completedOrderScenario(app);
    expect((await writeReview(buyer, order.id, 5, 'ส่งไวมาก ของดี')).status).toBe(201);
    const original = app.prisma.review.findFirst.bind(app.prisma.review) as (...args: unknown[]) => Promise<unknown>;
    let erasedStatus = 0;
    vi.spyOn(app.prisma.review, 'findFirst').mockImplementationOnce((async (...args: unknown[]) => {
      const found = await original(...args);
      erasedStatus = (await eraseAccount(buyer)).status;
      return found;
    }) as never);

    const edited = await buyer
      .patch(`${API}/orders/${order.id}/review`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .send({ rating: 1, text: 'แก้ใหม่: คนส่งชื่อสมชาย โทร 0812345678' });

    expect(erasedStatus).toBe(204);
    expect(edited.status).toBe(401);
    const listed = (await newClient(app).get(`${API}/shops/${shopId}/reviews`)).body as { items: { text: string | null; rating: number }[] };
    expect(listed.items).toEqual([expect.objectContaining({ rating: 5, text: ERASED_BUYER_TEXT_PLACEHOLDER })]);
  });

  describe('an unban landing while a super admin’s erasure of a buyer with a pending order is accepted', () => {
    async function bannedBuyerWithPendingOrder(app: TestApp): Promise<{ superAdmin: Agent; victim: Agent; victimId: string }> {
      const superAdmin = app.client;
      await signInAsSuperAdmin(app, superAdmin);
      const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
      const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
      const { seller } = await sellerWithShop(app, SELLER, communityId);
      const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบแบน', 10000, 5);
      const victim = newClient(app);
      const victimId = await registerVerified(app, victim, BUYER);
      const address = await createAddress(app, victim);
      await placeOrder(victim, address.id, product.variants[0]!.id);
      expect((await ban(superAdmin, victimId)).status).toBe(204);
      return { superAdmin, victim, victimId };
    }

    function unbanDuringNextErasure(app: TestApp, superAdmin: Agent, victimId: string): () => number {
      const shops = app.app.get(ShopService);
      const original = shops.closeForErasure.bind(shops);
      let unbanned = 0;
      vi.spyOn(shops, 'closeForErasure').mockImplementationOnce(async (...args) => {
        unbanned = (await superAdmin.post(`${API}/admin/users/${victimId}/unban`).set(CSRF_HEADER, await csrfToken(superAdmin))).status;
        return original(...args);
      });
      return () => unbanned;
    }

    it('does not queue it', async () => {
      const app = getApp();
      const { superAdmin, victim, victimId } = await bannedBuyerWithPendingOrder(app);
      const unbanned = unbanDuringNextErasure(app, superAdmin, victimId);

      const erased = await eraseAsAdmin(superAdmin, victimId);

      expect(unbanned()).toBe(204);
      expect(erased.status).toBe(409);
      await login(victim, BUYER);
      expect(((await victim.get(`${API}/auth/account/erasure-status`)).body as StatusBody).status).toBe('NONE');
    });

    it('does not answer "queued" when the unban withdrew the request an admin had queued before', async () => {
      const app = getApp();
      const { superAdmin, victim, victimId } = await bannedBuyerWithPendingOrder(app);
      expect((await eraseAsAdmin(superAdmin, victimId)).status).toBe(202);
      const unbanned = unbanDuringNextErasure(app, superAdmin, victimId);

      const erased = await eraseAsAdmin(superAdmin, victimId);

      expect(unbanned()).toBe(204);
      expect(erased.status).toBe(409);
      await login(victim, BUYER);
      expect(((await victim.get(`${API}/auth/account/erasure-status`)).body as StatusBody).status).toBe('NONE');
    });
  });
});

/**
 * §113 (owner's decision): an erased account's notifications go with it — nobody can sign in to
 * read them again, and some carry an admin's free-text reason about the person — and nothing is
 * emailed to the placeholder address an erased account is left with.
 */
describe('§113 — notifications of an erased account', () => {
  it('erasure deletes every notification the account had, and writes none after — the closing notice goes by email only', async () => {
    const app = getApp();
    const { buyer, buyerId } = await completedOrderScenario(app);
    expect(await app.prisma.notification.count({ where: { userId: buyerId } })).toBeGreaterThan(0);

    expect((await eraseAccount(buyer)).status).toBe(204);

    expect(await app.prisma.notification.count({ where: { userId: buyerId } })).toBe(0);
    expect(app.email.ofKind('ACCOUNT_ERASURE').map((m) => m.to)).toEqual([BUYER]);
  });

  it('a ruling overridden after the buyer was erased emails the shop, not the erased address', async () => {
    const app = getApp();
    const { superAdmin, buyer, buyerId, order } = await completedOrderScenario(app);
    const dispute = ((await buyer
      .post(`${API}/orders/${order.id}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'ของที่ได้รับไม่ตรงกับที่สั่งเลย ขอคืนเงิน')
      .attach('files', await aJpegBuffer(), 'evidence.jpg')).body as { id: string }).id;
    expect((await eraseAccount(buyer)).status).toBe(202);
    await superAdmin
      .post(`${API}/disputes/${dispute}/ruling`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ verdict: 'SHOP_WINS', reason: 'ตรวจหลักฐานแล้ว ร้านส่งของตรงตามที่ตกลงไว้ จึงให้ร้านเป็นฝ่ายถูก' });
    await app.sweep.run();
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: buyerId } })).erasedAt).not.toBeNull();
    app.email.clear();

    const overridden = await superAdmin
      .post(`${API}/disputes/${dispute}/override`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ verdict: 'BUYER_WINS', reason: 'ทบทวนแล้วเห็นว่าผู้ซื้อถูกต้อง ร้านส่งของไม่ตรงตามที่ลงขาย' });

    expect(overridden.status).toBe(200);
    const outcomes = app.email.ofKind('DISPUTE_OUTCOME');
    expect(outcomes.map((m) => m.to)).toEqual([SELLER]);
  });
});
