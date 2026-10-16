import sharp from 'sharp';
import type { Agent } from 'supertest';
import { vi } from 'vitest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import type { ErrorBody } from '../src/common/errors/error-payload.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, forgotPassword, linkTokenFrom, login, registerAndLogin, resetPassword } from './helpers/auth.js';
import { approveProduct, profileChangeRevision, productRevision, shopRevision } from './helpers/review.js';
import { DisputeService } from '../src/dispute/services/dispute.service.js';
import { StockReservationService } from '../src/order/services/stock-reservation.service.js';
import { TestApp, chatSocket, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';
import { beforeNextTransaction, untilSomeoneWaitsOnALock } from './helpers/interleave.js';

/**
 * §91 — the race conditions the 2026-09-28 audit confirmed, one describe block per finding.
 *
 * Each interleaving is forced, not hoped for: a `vi.spyOn` on a read the victim request makes lets
 * the competing request run to completion at exactly that point (the technique §81–§87 use), or the
 * two steps are simply taken one after the other when the race spans two requests (a reviewer's
 * screen, a seller's form). Seam 1 throughout: every arrangement and every competing action is an
 * HTTP request or a socket event.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const REASON = 'ขายสินค้าผิดกฎหมายตามที่มีผู้ร้องเรียนหลายราย';

type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };

async function send(client: Agent, method: 'post' | 'patch' | 'delete', path: string, body?: object) {
  const request = client[method](`${API}${path}`).set(CSRF_HEADER, await csrfToken(client));
  return body === undefined ? request : request.send(body);
}
const post = (client: Agent, path: string, body?: object) => send(client, 'post', path, body);

async function jpeg(seed = 1): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: seed % 255, g: 100, b: 50 } } }).jpeg().toBuffer();
}

async function uploadImage(seller: Agent, productId: string, seed: number) {
  return seller.post(`${API}/products/${productId}/images`).set(CSRF_HEADER, await csrfToken(seller)).attach('file', await jpeg(seed), 'p.jpg');
}

interface Variant {
  id: string;
  name: string;
  priceAmountMinor: number;
  stock: number;
}

/** Signs `client` up and makes it the platform super admin. */
async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

/** A super admin, a community and category, an approved shop with one PENDING product, and a buyer. */
async function marketplace(app: TestApp, variants = [{ name: 'กล่องเล็ก', priceAmountMinor: 10000, stock: 5 }]) {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const categoryId = ((await post(superAdmin, '/categories', { name: 'ขนมไทย' })).body as { id: string }).id;
  const seller = newClient(app);
  const sellerId = await registerVerified(app, seller, SELLER);
  const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
  await approveShop(app, shopId);
  const productId = ((await post(seller, '/products', { name: 'ขนมชั้นใบเตย', description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId, variants })).body as { id: string }).id;
  const buyer = newClient(app);
  const buyerId = await registerVerified(app, buyer, BUYER);

  return { superAdmin, communityId, categoryId, seller, sellerId, shopId, productId, buyer, buyerId };
}

/** `marketplace` with the product approved, and its variants as the seller's own page shows them. */
async function approvedMarketplace(app: TestApp, variants?: { name: string; priceAmountMinor: number; stock: number }[]) {
  const m = await marketplace(app, variants);
  await approveProduct(m.superAdmin, m.productId);
  const product = (await m.seller.get(`${API}/products/${m.productId}`)).body as { variants: Variant[] };

  return { ...m, variants: product.variants };
}

async function addressOf(app: TestApp, buyer: Agent) {
  const spc = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  return post(buyer, '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId: spc.id });
}

async function newAddressId(app: TestApp, buyer: Agent): Promise<string> {
  return ((await addressOf(app, buyer)).body as { id: string }).id;
}

/** Runs `during` right after the first call of `method` on `target` has read, then lets the read return. */
function interleave<T extends object>(target: T, method: keyof T, during: () => Promise<unknown>): void {
  const original = (target[method] as (...args: unknown[]) => Promise<unknown>).bind(target);
  vi.spyOn(target, method as never).mockImplementationOnce((async (...args: unknown[]) => {
    const read = await original(...args);
    await during();
    return read;
  }) as never);
}

describe('§91 — a reviewer decides on exactly what they looked at', () => {
  it('a product edited after the reviewer opened it is refused with STALE_VIEW, and the edit does not go live', async () => {
    const app = getApp();
    const { superAdmin, seller, productId, categoryId } = await marketplace(app);
    const seen = await productRevision(superAdmin, productId);
    expect(typeof seen).toBe('number');

    await send(seller, 'patch', `/products/${productId}`, { name: 'ของที่แอดมินยังไม่เคยเห็น', description: 'คำอธิบายสินค้าสำหรับทดสอบ', categoryId });
    const approved = await post(superAdmin, `/products/${productId}/approve`, { reviewRevision: seen });

    expect(approved.status).toBe(409);
    expect((approved.body as ErrorBody).code).toBe('STALE_VIEW');
    expect((await app.prisma.product.findUniqueOrThrow({ where: { id: productId } })).moderationStatus).toBe('PENDING');

    // Reloading shows the new revision, and deciding on that one works.
    expect((await approveProduct(superAdmin, productId)).status).toBe(200);
  });

  it('a stale rejection is refused the same way — even a PROHIBITED ruling waits for the reviewer to see the edit', async () => {
    const app = getApp();
    const { superAdmin, seller, productId } = await marketplace(app);
    const seen = await productRevision(superAdmin, productId);
    await uploadImage(seller, productId, 3);

    const rejected = await post(superAdmin, `/products/${productId}/reject`, { category: 'PROHIBITED', reason: 'เป็นสินค้าที่กฎหมายห้ามขาย', reviewRevision: seen });

    expect(rejected.status).toBe(409);
    expect((rejected.body as ErrorBody).code).toBe('STALE_VIEW');
  });

  it('a decision that does not say which revision it saw is a 400', async () => {
    const app = getApp();
    const { superAdmin, productId } = await marketplace(app);

    const approved = await post(superAdmin, `/products/${productId}/approve`);

    expect(approved.status).toBe(400);
    expect((approved.body as ErrorBody).fieldErrors).toHaveProperty('reviewRevision');
  });

  it('a shop application renamed after the reviewer opened it is refused', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
    const seen = await shopRevision(superAdmin, shopId);

    await send(seller, 'patch', '/shops/me', { name: 'ชื่อที่แอดมินยังไม่เห็น', description: '' });
    const approved = await post(superAdmin, `/shops/${shopId}/approve`, { reviewRevision: seen });

    expect(approved.status).toBe(409);
    expect((approved.body as ErrorBody).code).toBe('STALE_VIEW');
    expect((await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).approvalStatus).toBe('PENDING');
  });

  it('a profile change resubmitted after the reviewer opened it is refused, and the storefront keeps its live name', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId } = await marketplace(app);
    await send(seller, 'patch', '/shops/me', { name: 'ชื่อใหม่ที่ส่งตรวจ', description: '' });
    const seen = await profileChangeRevision(superAdmin, shopId);

    await send(seller, 'patch', '/shops/me', { name: 'ชื่อที่เปลี่ยนอีกรอบ', description: '' });
    const approved = await post(superAdmin, `/shops/${shopId}/profile-change/approve`, { reviewRevision: seen });

    expect(approved.status).toBe(409);
    expect((approved.body as ErrorBody).code).toBe('STALE_VIEW');
    expect((await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).name).toBe('ร้านขนมป้าแดง');
  });

  it('two reviewers approving the same shop at once: one wins, one gets 409, and audit_log records one approval', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
    const seen = await shopRevision(superAdmin, shopId);
    let second = 0;
    interleave(app.prisma.shop, 'findUnique', async () => {
      second = (await post(superAdmin, `/shops/${shopId}/approve`, { reviewRevision: seen })).status;
    });

    const first = await post(superAdmin, `/shops/${shopId}/approve`, { reviewRevision: seen });

    expect([first.status, second].sort()).toEqual([200, 409]);
    expect(await app.prisma.auditLog.count({ where: { action: 'SHOP_APPROVED', targetId: shopId } })).toBe(1);
  });
});

describe('§91 — nothing personal lands on an account while its erasure commits', () => {
  it('an address saved at that moment is refused, and no real name or phone is left behind', async () => {
    const app = getApp();
    const buyer = newClient(app);
    const buyerId = await registerVerified(app, buyer, BUYER);
    const otherDevice = newClient(app);
    await login(otherDevice, BUYER);
    let erased = 0;
    // The postal-code check is the last read before the save's transaction (§113 moved the
    // address count inside it, under the address-book lock).
    interleave(app.prisma.subdistrictPostalCode, 'findUnique', async () => {
      erased = (await post(otherDevice, '/auth/account/erase')).status;
    });

    const saved = await addressOf(app, buyer);

    expect(erased).toBe(204);
    expect(saved.status).toBe(401);
    expect(await app.prisma.address.count({ where: { userId: buyerId, recipientName: 'สมชาย ใจดี' } })).toBe(0);
  });

  it('a chat message sent at that moment is refused, and its words are not left on the erased account', async () => {
    const app = getApp();
    const { shopId, buyer, buyerId } = await approvedMarketplace(app);
    const socket = chatSocket(app, buyer);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
      socket.connect();
    });
    const emit = <T>(event: string, payload: unknown) =>
      new Promise<AckResponse<T>>((resolve) => socket.emit(event, payload, (response: AckResponse<T>) => resolve(response)));
    try {
      const room = await emit<{ id: string }>('openRoomWithShop', { shopId });
      const roomId = room.ok ? room.data.id : '';
      const otherDevice = newClient(app);
      await login(otherDevice, BUYER);
      let erased = 0;
      interleave(app.prisma.chatRoom, 'findFirst', async () => {
        erased = (await post(otherDevice, '/auth/account/erase')).status;
      });

      // The erasure ends this socket's session, so the ack may never make it back — the outcome
      // that matters is what the database kept, not what the socket heard.
      await Promise.race([emit('sendMessage', { roomId, content: 'เบอร์ผม 0812345678 นะครับ' }), new Promise((resolve) => setTimeout(resolve, 3000))]);

      expect(erased).toBe(204);
      expect(await app.prisma.chatMessage.count({ where: { senderId: buyerId, content: { contains: '0812345678' } } })).toBe(0);
    } finally {
      socket.disconnect();
    }
  });
});

describe('§91 — an order placed while its shop or buyer is being stopped', () => {
  it('a shop suspended between reading the cart and placing the order: the order is refused', async () => {
    const app = getApp();
    const { superAdmin, shopId, buyer, variants } = await approvedMarketplace(app);
    const addressId = await newAddressId(app, buyer);
    await post(buyer, '/cart/items', { variantId: variants[0]!.id, quantity: 1 });
    let suspended = 0;
    beforeNextTransaction(app, async () => {
      suspended = (await post(superAdmin, `/shops/${shopId}/suspend`, { reason: REASON })).status;
    });

    const placed = await checkoutAsShown(buyer, addressId);

    expect(suspended).toBe(200);
    expect(placed.status).toBe(409);
    expect((placed.body as ErrorBody).code).toBe('STALE_VIEW'); // §111: caught under the locks, same answer as before them
    expect(await app.prisma.order.count({ where: { shopId } })).toBe(0);
  });

  it('a buyer banned between reading the cart and placing the order: the order is refused', async () => {
    const app = getApp();
    const { superAdmin, shopId, buyer, buyerId, variants } = await approvedMarketplace(app);
    const addressId = await newAddressId(app, buyer);
    await post(buyer, '/cart/items', { variantId: variants[0]!.id, quantity: 1 });
    let banned = 0;
    beforeNextTransaction(app, async () => {
      banned = (await post(superAdmin, `/admin/users/${buyerId}/ban`, { reason: REASON })).status;
    });

    const placed = await checkoutAsShown(buyer, addressId);

    expect(banned).toBe(204);
    expect(placed.status).toBe(403);
    expect((placed.body as ErrorBody).code).toBe('ACCOUNT_BANNED');
    expect(await app.prisma.order.count({ where: { shopId } })).toBe(0);
  });
});

describe('§91 — a product’s limits hold under concurrent edits', () => {
  it('deleting its last two variants at once leaves one: the second delete is refused', async () => {
    const app = getApp();
    const { seller, productId, variants } = await approvedMarketplace(app, [
      { name: 'กล่องเล็ก', priceAmountMinor: 10000, stock: 5 },
      { name: 'กล่องใหญ่', priceAmountMinor: 20000, stock: 5 },
    ]);
    let second = 0;
    interleave(app.prisma.product, 'findFirst', async () => {
      second = (await send(seller, 'delete', `/products/${productId}/variants/${variants[1]!.id}`)).status;
    });

    const first = await send(seller, 'delete', `/products/${productId}/variants/${variants[0]!.id}`);

    expect([first.status, second].sort()).toEqual([200, 409]);
    expect(await app.prisma.productVariant.count({ where: { productId, deletedAt: null } })).toBe(1);
  });

  it('a photo uploaded while another is being added never takes the product past 10', async () => {
    const app = getApp();
    const { seller, productId } = await marketplace(app);
    for (let i = 0; i < 9; i += 1) {
      expect((await uploadImage(seller, productId, i)).status).toBeLessThan(300);
    }
    interleave(app.prisma.product, 'findFirst', async () => {
      await uploadImage(seller, productId, 77);
    });

    const last = await uploadImage(seller, productId, 99);

    expect(last.status).toBe(409);
    expect(await app.prisma.productImage.count({ where: { productId } })).toBe(10);
  });
});

describe('§91 — a variant form sends the stock it showed', () => {
  it('a price edit from a form opened before a payment was confirmed is refused, and the sold units stay sold', async () => {
    const app = getApp();
    const { seller, buyer, productId, variants } = await approvedMarketplace(app);
    const shown = variants[0]!;
    const addressId = await newAddressId(app, buyer);
    await post(buyer, '/cart/items', { variantId: shown.id, quantity: 2 });
    const order = ((await checkoutAsShown(buyer, addressId)).body as { id: string }[])[0]!;
    await post(seller, `/shops/me/orders/${order.id}/shipping-fee`, { shippingAmountMinor: 2000 });
    await buyer.post(`${API}/orders/${order.id}/payment-slips`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await jpeg(), 's.jpg');
    expect((await post(seller, `/shops/me/orders/${order.id}/confirm-payment`)).status).toBe(200);

    const saved = await send(seller, 'patch', `/products/${productId}/variants/${shown.id}`, {
      name: shown.name,
      priceAmountMinor: 12000,
      stock: shown.stock,
      expectedStock: shown.stock,
    });

    expect(saved.status).toBe(409);
    expect((saved.body as ErrorBody).code).toBe('STALE_VIEW');
    const row = await app.prisma.productVariant.findUniqueOrThrow({ where: { id: shown.id } });
    expect([row.stock, row.priceAmountMinor]).toEqual([3, 10000]);
  });

  it('a variant edit without the stock it showed is a 400', async () => {
    const app = getApp();
    const { seller, productId, variants } = await approvedMarketplace(app);

    const saved = await send(seller, 'patch', `/products/${productId}/variants/${variants[0]!.id}`, { name: 'กล่องเล็ก', priceAmountMinor: 12000, stock: 5 });

    expect(saved.status).toBe(400);
    expect((saved.body as ErrorBody).fieldErrors).toHaveProperty('expectedStock');
  });
});

describe('§91 — a row that vanished mid-request is a 404, not a 500', () => {
  it('changing a cart line while the same cart is checked out', async () => {
    const app = getApp();
    const { buyer, variants } = await approvedMarketplace(app);
    const addressId = await newAddressId(app, buyer);
    const item = ((await post(buyer, '/cart/items', { variantId: variants[0]!.id, quantity: 1 })).body as { items: { id: string }[] }).items[0]!;
    interleave(app.prisma.cartItem, 'findFirst', async () => {
      await checkoutAsShown(buyer, addressId);
    });

    const changed = await send(buyer, 'patch', `/cart/items/${item.id}`, { quantity: 3 });

    expect(changed.status).toBe(404);
  });

  it('removing a cart line while the same cart is checked out', async () => {
    const app = getApp();
    const { buyer, variants } = await approvedMarketplace(app);
    const addressId = await newAddressId(app, buyer);
    const item = ((await post(buyer, '/cart/items', { variantId: variants[0]!.id, quantity: 1 })).body as { items: { id: string }[] }).items[0]!;
    interleave(app.prisma.cartItem, 'findFirst', async () => {
      await checkoutAsShown(buyer, addressId);
    });

    const removed = await send(buyer, 'delete', `/cart/items/${item.id}`);

    expect(removed.status).toBe(404);
  });

  it('editing a payment channel while it is being deleted', async () => {
    const app = getApp();
    const { seller } = await approvedMarketplace(app);
    const channel = { type: 'PROMPTPAY', promptPayId: '0899999999' };
    const channelId = ((await post(seller, '/shops/me/payment-channels', channel)).body as { id: string }).id;
    interleave(app.prisma.paymentChannel, 'findFirst', async () => {
      await send(seller, 'delete', `/shops/me/payment-channels/${channelId}`);
    });

    const edited = await send(seller, 'patch', `/shops/me/payment-channels/${channelId}`, { type: 'PROMPTPAY', promptPayId: '0811111111' });

    expect(edited.status).toBe(404);
  });
});

describe('§91 — two admins taking the same action at once', () => {
  it('banning: one succeeds, the other gets 409, and audit_log records one ban', async () => {
    const app = getApp();
    const { superAdmin, buyerId } = await marketplace(app);
    let second = 0;
    interleave(app.prisma.user, 'findUnique', async () => {
      second = (await post(superAdmin, `/admin/users/${buyerId}/ban`, { reason: REASON })).status;
    });

    const first = await post(superAdmin, `/admin/users/${buyerId}/ban`, { reason: REASON });

    expect([first.status, second].sort()).toEqual([204, 409]);
    expect(await app.prisma.auditLog.count({ where: { action: 'USER_BANNED', targetId: buyerId } })).toBe(1);
  });

  it('suspending: one succeeds, the other gets 409, and the owner is told once', async () => {
    const app = getApp();
    const { superAdmin, shopId, sellerId } = await marketplace(app);
    let second = 0;
    interleave(app.prisma.shop, 'findUnique', async () => {
      second = (await post(superAdmin, `/shops/${shopId}/suspend`, { reason: REASON })).status;
    });

    const first = await post(superAdmin, `/shops/${shopId}/suspend`, { reason: REASON });

    expect([first.status, second].sort()).toEqual([200, 409]);
    expect(await app.prisma.auditLog.count({ where: { action: 'SHOP_SUSPENDED', targetId: shopId } })).toBe(1);
    expect(await app.prisma.notification.count({ where: { userId: sellerId, type: 'SHOP_SUSPENDED' } })).toBe(1);
  });
});

describe('§91 — a password reset ends every session, including one signed in at that very moment', () => {
  it('a sign-in with the old password that was mid-check when the reset landed gets no session', async () => {
    const app = getApp();
    const victim = newClient(app);
    await registerAndLogin(victim, BUYER);
    app.email.clear();
    await forgotPassword(newClient(app), BUYER);
    const message = app.email.ofKind('PASSWORD_RESET').at(-1);
    const token = linkTokenFrom(message!.body);

    const attacker = newClient(app);
    const original = app.prisma.user.findUnique.bind(app.prisma.user);
    let reset = 0;
    vi.spyOn(app.prisma.user, 'findUnique').mockImplementation((async (args: { where: { email?: string } }) => {
      const read = await original(args as never);
      if (args.where.email === BUYER && reset === 0) {
        reset = -1;
        reset = (await resetPassword(newClient(app), token, 'a-completely-different-passphrase')).status;
      }
      return read;
    }) as never);

    const signedIn = await login(attacker, BUYER);
    vi.restoreAllMocks();

    expect(reset).toBe(204);
    expect(signedIn.status).toBe(401);
    expect((await attacker.get(`${API}/auth/me`)).status).toBe(401);
  });
});

describe('§91 — a dispute cannot open on a refund that completed at the same moment', () => {
  it('the buyer confirms the refund while their dispute is being filed: the dispute is refused', async () => {
    const app = getApp();
    const { seller, buyer, variants } = await approvedMarketplace(app);
    const addressId = await newAddressId(app, buyer);
    await post(buyer, '/cart/items', { variantId: variants[0]!.id, quantity: 1 });
    const order = ((await checkoutAsShown(buyer, addressId)).body as { id: string }[])[0]!;
    await post(seller, `/shops/me/orders/${order.id}/shipping-fee`, { shippingAmountMinor: 2000 });
    await buyer.post(`${API}/orders/${order.id}/payment-slips`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await jpeg(), 's.jpg');
    app.clock.advanceByDays(3);
    await app.sweep.run();
    await login(buyer, BUYER);
    await login(seller, SELLER);
    await post(buyer, `/orders/${order.id}/refund-account`, { type: 'PROMPTPAY', promptPayId: '0899999999' });
    await seller.post(`${API}/shops/me/orders/${order.id}/refund-slips`).set(CSRF_HEADER, await csrfToken(seller)).attach('file', await jpeg(5), 'r.jpg');
    let confirmed = 0;
    interleave(app.prisma.paymentSlip, 'count', async () => {
      confirmed = (await post(buyer, `/orders/${order.id}/refund-received`)).status;
    });

    const opened = await buyer
      .post(`${API}/orders/${order.id}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'ได้รับเงินคืนไม่ครบตามจำนวนที่ตกลงกันไว้')
      .attach('files', await jpeg(9), 'e.jpg');

    expect(confirmed).toBe(200);
    expect(opened.status).toBe(409);
    expect(await app.prisma.dispute.count({ where: { orderId: order.id } })).toBe(0);
  });
});

describe('§91 review — the rest of the stale-view decisions', () => {
  it('rejecting a shop application renamed after the reviewer opened it is refused', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
    const seller = newClient(app);
    await registerVerified(app, seller, SELLER);
    const shopId = ((await post(seller, '/shops', { communityId, name: 'ร้านขนมป้าแดง' })).body as { id: string }).id;
    const seen = await shopRevision(superAdmin, shopId);

    await send(seller, 'patch', '/shops/me', { name: 'ชื่อที่แก้ให้ตรงตามกฎแล้ว', description: '' });
    const rejected = await post(superAdmin, `/shops/${shopId}/reject`, { reason: 'ชื่อร้านไม่ตรงตามกฎของชุมชน', reviewRevision: seen });

    expect(rejected.status).toBe(409);
    expect((rejected.body as ErrorBody).code).toBe('STALE_VIEW');
  });

  it('rejecting a profile change resubmitted after the reviewer opened it is refused', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId } = await marketplace(app);
    await send(seller, 'patch', '/shops/me', { name: 'ชื่อใหม่ที่ส่งตรวจ', description: '' });
    const seen = await profileChangeRevision(superAdmin, shopId);

    await send(seller, 'patch', '/shops/me', { name: 'ชื่อที่เปลี่ยนอีกรอบ', description: '' });
    const rejected = await post(superAdmin, `/shops/${shopId}/profile-change/reject`, { reason: 'ชื่อใหม่ไม่ตรงตามกฎของชุมชน', reviewRevision: seen });

    expect(rejected.status).toBe(409);
    expect((rejected.body as ErrorBody).code).toBe('STALE_VIEW');
  });
});

describe('§91 review — the holes the scrutiny found', () => {
  it('a suspension that arrives while a checkout holds its locks waits, then freezes the new order', async () => {
    const app = getApp();
    const { superAdmin, shopId, buyer, variants } = await approvedMarketplace(app);
    const addressId = await newAddressId(app, buyer);
    await post(buyer, '/cart/items', { variantId: variants[0]!.id, quantity: 1 });
    const reservations = app.app.get(StockReservationService);
    const original = reservations.checkAndLock.bind(reservations);
    let suspension: Promise<number> | undefined;
    vi.spyOn(reservations, 'checkAndLock').mockImplementationOnce(async (...args) => {
      // Not awaited: the suspension has to queue behind the shop lock this checkout now holds.
      suspension = post(superAdmin, `/shops/${shopId}/suspend`, { reason: REASON }).then((response) => response.status);
      await untilSomeoneWaitsOnALock(app);
      return original(...args);
    });

    const placed = await checkoutAsShown(buyer, addressId);
    const suspended = await suspension;

    expect(placed.status).toBe(201);
    expect(suspended).toBe(200);
    const order = await app.prisma.order.findFirstOrThrow({ where: { shopId } });
    expect(order.frozenAt).not.toBeNull();
  });

  it('a shop closing itself while an order is being placed is refused, not closed with the order open', async () => {
    const app = getApp();
    const { seller, shopId, buyer, variants } = await approvedMarketplace(app);
    const addressId = await newAddressId(app, buyer);
    await post(buyer, '/cart/items', { variantId: variants[0]!.id, quantity: 1 });
    let placed = 0;
    interleave(app.prisma.order, 'findMany', async () => {
      placed = (await checkoutAsShown(buyer, addressId)).status;
    });

    const closed = await post(seller, `/shops/${shopId}/close`);

    expect(placed).toBe(201);
    expect(closed.status).toBe(409);
    expect((await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).closedAt).toBeNull();
  });

  it('banning a seller while their dispute is being ruled against them: both land, neither deadlocks', async () => {
    const app = getApp();
    const { superAdmin, seller, sellerId, buyer, variants } = await approvedMarketplace(app);
    const addressId = await newAddressId(app, buyer);
    await post(buyer, '/cart/items', { variantId: variants[0]!.id, quantity: 1 });
    const order = ((await checkoutAsShown(buyer, addressId)).body as { id: string }[])[0]!;
    await post(seller, `/shops/me/orders/${order.id}/shipping-fee`, { shippingAmountMinor: 2000 });
    await buyer.post(`${API}/orders/${order.id}/payment-slips`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await jpeg(), 's.jpg');
    const opened = await buyer
      .post(`${API}/orders/${order.id}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'โอนเงินแล้วแต่ร้านไม่ยอมยืนยันและไม่ตอบแชท')
      .attach('files', await jpeg(9), 'e.jpg');
    const disputeId = (opened.body as { id: string }).id;

    // Inside the ruling's transaction, once it holds the order: the ban starts, locks the seller,
    // and queues for the order. The ruling then goes on to the seller's row.
    // `orderRefund` is private; it is the one call made inside the ruling's transaction after the
    // order is locked, which is exactly the moment this interleaving needs.
    type WithOrderRefund = { orderRefund: (...args: unknown[]) => Promise<boolean> };
    const disputes: WithOrderRefund = app.app.get<DisputeService, WithOrderRefund>(DisputeService);
    const original = disputes.orderRefund.bind(disputes);
    let ban: Promise<number> | undefined;
    vi.spyOn(disputes, 'orderRefund').mockImplementationOnce(async (...args: unknown[]) => {
      ban = post(superAdmin, `/admin/users/${sellerId}/ban`, { reason: REASON }).then((response) => response.status);
      await untilSomeoneWaitsOnALock(app);
      return original(...args);
    });

    const ruled = await post(superAdmin, `/disputes/${disputeId}/ruling`, { verdict: 'BUYER_WINS', reason: 'ร้านไม่มีหลักฐานว่าส่งของแล้ว' });
    const banned = await ban;

    expect([ruled.status, banned]).toEqual([200, 204]);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: sellerId } })).disputeLostCount).toBe(1);
  });
});

describe('§91 review — the paths the spec review found untested', () => {
  it('unbanning twice at once: one succeeds, the other gets 409, and audit_log records one unban', async () => {
    const app = getApp();
    const { superAdmin, buyerId } = await marketplace(app);
    await post(superAdmin, `/admin/users/${buyerId}/ban`, { reason: REASON });
    let second = 0;
    interleave(app.prisma.user, 'findUnique', async () => {
      second = (await post(superAdmin, `/admin/users/${buyerId}/unban`)).status;
    });

    const first = await post(superAdmin, `/admin/users/${buyerId}/unban`);

    expect([first.status, second].sort()).toEqual([204, 409]);
    expect(await app.prisma.auditLog.count({ where: { action: 'USER_UNBANNED', targetId: buyerId } })).toBe(1);
  });

  it('two variants added at once never take a product past its variant cap', async () => {
    const app = getApp();
    const variants = Array.from({ length: 49 }, (_, i) => ({ name: `ตัวเลือก ${String(i)}`, priceAmountMinor: 10000, stock: 1 }));
    const { seller, productId } = await approvedMarketplace(app, variants);
    let second = 0;
    interleave(app.prisma.product, 'findFirst', async () => {
      second = (await post(seller, `/products/${productId}/variants`, { name: 'ตัวที่ห้าสิบ', priceAmountMinor: 10000, stock: 1 })).status;
    });

    const first = await post(seller, `/products/${productId}/variants`, { name: 'ตัวที่ห้าสิบเอ็ด', priceAmountMinor: 10000, stock: 1 });

    expect([first.status, second].sort()).toEqual([201, 409]);
    expect(await app.prisma.productVariant.count({ where: { productId, deletedAt: null } })).toBe(50);
  });

  it('a chat edit made while the account is being erased does not put its words back', async () => {
    const app = getApp();
    const { shopId, buyer, buyerId } = await approvedMarketplace(app);
    const socket = chatSocket(app, buyer);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
      socket.connect();
    });
    const emit = <T>(event: string, payload: unknown) =>
      new Promise<AckResponse<T>>((resolve) => socket.emit(event, payload, (response: AckResponse<T>) => resolve(response)));
    try {
      const room = await emit<{ id: string }>('openRoomWithShop', { shopId });
      const roomId = room.ok ? room.data.id : '';
      const sent = await emit<{ id: string }>('sendMessage', { roomId, content: 'สวัสดีครับ' });
      const messageId = sent.ok ? sent.data.id : '';
      const otherDevice = newClient(app);
      await login(otherDevice, BUYER);
      let erased = 0;
      interleave(app.prisma.chatRoom, 'findFirst', async () => {
        erased = (await post(otherDevice, '/auth/account/erase')).status;
      });

      await Promise.race([emit('editMessage', { roomId, messageId, content: 'เบอร์ผม 0812345678 นะครับ' }), new Promise((resolve) => setTimeout(resolve, 3000))]);

      expect(erased).toBe(204);
      expect(await app.prisma.chatMessage.count({ where: { senderId: buyerId, content: { contains: '0812345678' } } })).toBe(0);
      expect(await app.prisma.chatMessageVersion.count({ where: { content: { contains: '0812345678' } } })).toBe(0);
    } finally {
      socket.disconnect();
    }
  });
});
