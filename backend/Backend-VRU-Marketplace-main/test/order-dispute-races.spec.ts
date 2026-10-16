import sharp from 'sharp';
import type { Agent } from 'supertest';
import { vi } from 'vitest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { OrderFreezeService } from '../src/order/services/order-freeze.service.js';
import { approveShop, registerVerified, suspendShop } from './helpers/arrange.js';
import { API, csrfToken, login, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';
import { pauseNextTransactionAfterRawQuery, untilSomeoneWaitsOnALock } from './helpers/interleave.js';

/**
 * §94/§95: races between orders, freezes and disputes that span modules — each found by the
 * scrutiny of §94 and each shown here by forcing the interleaving that breaks it, the same way
 * §91/§92 do (`vi.spyOn` holds one side at a chosen point; the other side goes through HTTP).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const BAN_REASON = 'ขายสินค้าผิดกฎหมายซ้ำหลังตักเตือนแล้วสองครั้ง';
const RULING_REASON = 'จากหลักฐานทั้งสองฝ่าย สินค้าที่ส่งไม่ตรงตามที่ตกลงไว้จริง ผู้ซื้อจึงเป็นฝ่ายถูก';

interface OrderBody {
  id: string;
  status: string;
  displayStatus: string;
}
interface DisputeBody {
  id: string;
  verdict: string | null;
  closedAt: string | null;
  shopResponse: string | null;
}

async function post(client: Agent, path: string, body?: object) {
  const request = client.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(client));
  return body === undefined ? request : request.send(body);
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function createCommunityAndCategory(superAdmin: Agent): Promise<{ communityId: string; categoryId: string }> {
  const communityId = ((await post(superAdmin, '/communities', { name: 'ชุมชนบางแสน', description: 'รายละเอียดสำหรับทดสอบ' })).body as { id: string }).id;
  const categoryId = ((await post(superAdmin, '/categories', { name: 'ขนมไทย' })).body as { id: string }).id;
  return { communityId, categoryId };
}

/** A verified account with an approved shop selling one approved product. */
async function sellerWithProduct(app: TestApp, superAdmin: Agent, email: string, communityId: string, categoryId: string) {
  const seller = newClient(app);
  const sellerId = await registerVerified(app, seller, email);
  const shopId = ((await post(seller, '/shops', { communityId, name: `ร้าน ${email}` })).body as { id: string }).id;
  await approveShop(app, shopId);
  const product = (await post(seller, '/products', {
    name: 'ขนมชั้นใบเตย',
    description: 'คำอธิบายสินค้าสำหรับทดสอบ',
    categoryId,
    variants: [{ name: 'กล่องเล็ก', priceAmountMinor: 10000, stock: 20 }],
  })).body as { id: string; variants: { id: string }[] };
  await approveProduct(superAdmin, product.id);
  return { seller, sellerId, shopId, variantId: product.variants[0]!.id };
}

async function placeOrder(app: TestApp, buyer: Agent, variantId: string): Promise<OrderBody> {
  const subdistrictPostalCodeId = (await app.prisma.subdistrictPostalCode.findFirstOrThrow()).id;
  const address = (await post(buyer, '/addresses', { recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId })).body as { id: string };
  await post(buyer, '/cart/items', { variantId, quantity: 1 });
  const placed = await checkoutAsShown(buyer, address.id);
  if (placed.status !== 201) {
    throw new Error(`checkout answered ${placed.status}`);
  }
  return (placed.body as OrderBody[])[0]!;
}

async function uploadSlip(buyer: Agent, orderId: string): Promise<void> {
  const uploaded = await buyer.post(`${API}/orders/${orderId}/payment-slips`).set(CSRF_HEADER, await csrfToken(buyer)).attach('file', await aJpegBuffer(), 'slip.jpg');
  if (uploaded.status !== 201) {
    throw new Error(`slip upload answered ${uploaded.status}`);
  }
}

async function openDispute(buyer: Agent, orderId: string) {
  return buyer
    .post(`${API}/orders/${orderId}/dispute`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .field('reason', 'สินค้าที่ได้รับไม่ตรงกับที่สั่งเลยครับ')
    .attach('files', await aJpegBuffer(), 'evidence.jpg');
}

async function respondToDispute(seller: Agent, orderId: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/dispute/respond`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .field('response', 'ทางร้านส่งของตรงตามที่ตกลงไว้ มีหลักฐานการส่งแนบมาด้วย')
    .attach('files', await aJpegBuffer(), 'response.jpg');
}

async function orderOf(buyer: Agent, orderId: string): Promise<OrderBody> {
  return (await buyer.get(`${API}/orders/${orderId}`)).body as OrderBody;
}

async function disputesOf(buyer: Agent, orderId: string): Promise<DisputeBody[]> {
  return (await buyer.get(`${API}/orders/${orderId}/dispute`)).body as DisputeBody[];
}

/**
 * `OrderFreezeService.addReason` — private, and spied on for the moment between a freeze listing an
 * order and locking it. Typed through `unknown` on purpose: the method is not part of any contract.
 */
function privateFreezeStep(app: TestApp): { addReason: (...args: unknown[]) => Promise<void> } {
  const service: unknown = app.app.get(OrderFreezeService);
  return service as { addReason: (...args: unknown[]) => Promise<void> };
}

/** One shop, one buyer, one order with its shipping fee set and a slip up (`PAYMENT_SUBMITTED`). */
async function slipUpScenario(app: TestApp) {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const { communityId, categoryId } = await createCommunityAndCategory(superAdmin);
  const shop = await sellerWithProduct(app, superAdmin, SELLER, communityId, categoryId);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, shop.variantId);
  await post(shop.seller, `/shops/me/orders/${order.id}/shipping-fee`, { shippingAmountMinor: 2000 });
  await uploadSlip(buyer, order.id);
  return { superAdmin, ...shop, buyer, order, communityId, categoryId };
}

describe('§95 O1 — a freeze never lands on an order that has already finished', () => {
  it('a seller banned while the buyer marks the shipped order received: the order completes and stays unfrozen', async () => {
    const app = getApp();
    const { superAdmin, seller, sellerId, buyer, order } = await slipUpScenario(app);
    expect((await post(seller, `/shops/me/orders/${order.id}/confirm-payment`)).status).toBe(200);
    const carrier = (await post(superAdmin, '/shipping-carriers', { name: 'Kerry' })).body as { id: string };
    expect((await post(seller, `/shops/me/orders/${order.id}/ship`, { shippingCarrierId: carrier.id, trackingNumber: 'TH1234567890' })).status).toBe(200);

    // The ban has already listed the order as in flight (SHIPPED); the buyer completes it before
    // the ban reaches it.
    const freeze = privateFreezeStep(app);
    const original = freeze.addReason.bind(freeze);
    let received = 0;
    vi.spyOn(freeze, 'addReason').mockImplementationOnce(async (...args: unknown[]) => {
      received = (await post(buyer, `/orders/${order.id}/receive`)).status;
      return original(...args);
    });

    const banned = await post(superAdmin, `/admin/users/${sellerId}/ban`, { reason: BAN_REASON });

    expect(received).toBe(200);
    expect(banned.status).toBe(204);
    const after = await orderOf(buyer, order.id);
    expect(after.status).toBe('COMPLETED');
    expect(after.displayStatus).not.toBe('FROZEN');
  });
});

describe('§95 O2 — dispute rows are locked after the account and the order, like every other path', () => {
  it('ruling BUYER_WINS while the shop is answering: both succeed, no deadlock', async () => {
    const app = getApp();
    const { superAdmin, seller, buyer, order } = await slipUpScenario(app);
    const dispute = (await openDispute(buyer, order.id)).body as DisputeBody;
    let ruling: Promise<number> | undefined;
    // The shop's answer holds its owner's row (the first raw query of `respond`) while the ruling
    // arrives and queues.
    pauseNextTransactionAfterRawQuery(app, 1, async () => {
      ruling = post(superAdmin, `/disputes/${dispute.id}/ruling`, { verdict: 'BUYER_WINS', reason: RULING_REASON }).then((response) => response.status);
      await untilSomeoneWaitsOnALock(app);
    });

    const responded = await respondToDispute(seller, order.id);

    expect(responded.status).toBe(200);
    expect(await ruling).toBe(200);
    expect((await orderOf(buyer, order.id)).status).toBe('REFUND_ORDERED');
  });

  it('overriding a ruling while the shop tries to answer: the override succeeds, and the answer — arriving after a ruling — is refused and records nothing', async () => {
    const app = getApp();
    const { superAdmin, seller, buyer, order } = await slipUpScenario(app);
    const dispute = (await openDispute(buyer, order.id)).body as DisputeBody;
    expect((await post(superAdmin, `/disputes/${dispute.id}/ruling`, { verdict: 'BUYER_WINS', reason: RULING_REASON })).status).toBe(200);

    // §102 (owner's decision): the shop answers before the ruling, not after — so this pair, which
    // §95 had to order its locks for, no longer meets inside a transaction: the answer is refused by
    // the check before it (the ruling has already happened here). What still races — the first
    // ruling against the answer — is the test above.
    const [overridden, responded] = await Promise.all([
      post(superAdmin, `/disputes/${dispute.id}/override`, {
        verdict: 'SHOP_WINS',
        reason: 'ตรวจหลักฐานการส่งของเพิ่มเติมแล้ว ร้านส่งของตรงตามที่ตกลงไว้จริง จึงกลับคำตัดสิน',
      }),
      respondToDispute(seller, order.id),
    ]);

    expect(overridden.status).toBe(200);
    expect(responded.status).toBe(409);
    const [current] = await disputesOf(buyer, order.id);
    expect(current!.verdict).toBe('SHOP_WINS');
    expect(current!.shopResponse).toBeNull();
  });
});

describe('§95 O3 — the 7-day refund sweep never closes a dispute opened at the same moment', () => {
  it('a dispute opened while the sweep is closing the refund stays open, and the order is not closed under it', async () => {
    const app = getApp();
    const { seller, buyer, order } = await slipUpScenario(app);
    app.clock.advanceByDays(3);
    await app.sweep.run(); // clock 3 runs out: REFUND_ORDERED (I1)
    await login(buyer, BUYER);
    await login(seller, SELLER);
    expect((await post(buyer, `/orders/${order.id}/refund-account`, { type: 'PROMPTPAY', promptPayId: '0899999999' })).status).toBe(200);
    expect((await seller.post(`${API}/shops/me/orders/${order.id}/refund-slips`).set(CSRF_HEADER, await csrfToken(seller)).attach('file', await aJpegBuffer(), 'refund.jpg')).status).toBe(201);
    app.clock.advanceByDays(7);
    await login(buyer, BUYER);

    let sweeping: Promise<unknown> | undefined;
    // `open`'s third raw query takes the order FOR SHARE (after the buyer's and, §96, the shop
    // owner's rows); the sweep starts while it is held.
    pauseNextTransactionAfterRawQuery(app, 3, async () => {
      sweeping = app.sweep.run();
      await untilSomeoneWaitsOnALock(app);
    });

    const opened = await openDispute(buyer, order.id);
    // The sweep must really have run inside the window — otherwise every assertion below holds
    // trivially and this test proves nothing.
    expect(sweeping).toBeDefined();
    await sweeping;

    expect(opened.status).toBe(201);
    const disputes = await disputesOf(buyer, order.id);
    expect(disputes).toHaveLength(1);
    expect(disputes[0]!.closedAt).toBeNull();
    expect((await orderOf(buyer, order.id)).status).toBe('REFUND_ORDERED');
  });
});

describe('§95 O4 — one ban freezes its orders in a single id order', () => {
  it('two sellers who bought from each other, banned at the same moment: both bans succeed and both orders freeze', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const { communityId, categoryId } = await createCommunityAndCategory(superAdmin);
    const a = await sellerWithProduct(app, superAdmin, 'seller-a@example.test', communityId, categoryId);
    const b = await sellerWithProduct(app, superAdmin, 'seller-b@example.test', communityId, categoryId);
    const aBoughtFromB = await placeOrder(app, a.seller, b.variantId);
    const bBoughtFromA = await placeOrder(app, b.seller, a.variantId);

    // A's ban holds its first order; B's ban starts and queues behind it. Before §95, A locked its
    // purchase first and B its own purchase first, then each wanted the other's.
    const freeze = privateFreezeStep(app);
    const original = freeze.addReason.bind(freeze);
    let banningB: Promise<number> | undefined;
    vi.spyOn(freeze, 'addReason').mockImplementationOnce(async (...args: unknown[]) => {
      await original(...args);
      banningB = post(superAdmin, `/admin/users/${b.sellerId}/ban`, { reason: BAN_REASON }).then((response) => response.status);
      await untilSomeoneWaitsOnALock(app);
    });

    const bannedA = await post(superAdmin, `/admin/users/${a.sellerId}/ban`, { reason: BAN_REASON });

    expect(bannedA.status).toBe(204);
    expect(await banningB).toBe(204);
    await superAdmin.post(`${API}/admin/users/${a.sellerId}/unban`).set(CSRF_HEADER, await csrfToken(superAdmin));
    await login(a.seller, 'seller-a@example.test');
    // A is unbanned, B is still banned: A's purchase from B stays frozen (B is its seller), and B's
    // purchase from A stays frozen (B is its buyer).
    expect((await orderOf(a.seller, aBoughtFromB.id)).displayStatus).toBe('FROZEN');
    const aShopOrders = (await a.seller.get(`${API}/shops/me/orders`)).body as { items: OrderBody[] };
    expect(aShopOrders.items.find((item) => item.id === bBoughtFromA.id)?.displayStatus).toBe('FROZEN');
  });
});

describe('§95 O5 — a deadline warning is not sent for an order frozen after the sweep listed it', () => {
  it('clock 1 warning: the shop is suspended between the sweep’s read and its write — no warning goes out', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const { communityId, categoryId } = await createCommunityAndCategory(superAdmin);
    const { shopId, variantId } = await sellerWithProduct(app, superAdmin, SELLER, communityId, categoryId);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    await placeOrder(app, buyer, variantId);
    app.email.clear();
    app.clock.advanceByHours(19);

    const original = app.prisma.order.findMany.bind(app.prisma.order) as (...args: unknown[]) => Promise<{ id: string }[]>;
    let suspended = false;
    vi.spyOn(app.prisma.order, 'findMany').mockImplementation((async (...args: unknown[]) => {
      const rows = await original(...args);
      const where = (args[0] as { where?: Record<string, unknown> } | undefined)?.where;
      if (!suspended && where !== undefined && 'shippingQuoteWarningSentAt' in where && rows.length > 0) {
        suspended = true;
        await suspendShop(app, shopId);
      }
      return rows;
    }) as never);

    await app.sweep.run();

    expect(suspended).toBe(true);
    expect(app.email.ofKind('DEADLINE_WARNING')).toHaveLength(0);
  });
});
