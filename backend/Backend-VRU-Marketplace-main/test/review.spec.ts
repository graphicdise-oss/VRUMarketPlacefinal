import sharp from 'sharp';
import { vi } from 'vitest';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { newId } from '../src/common/id.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct, approveShopAs } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #60 (K10/I18/I18b/I18c/L3): one review per order, writable only after the buyer marks it
 * received, editable for 7 days from the day it was written, never deletable by its own author or
 * the shop — only a community admin, with a reason, and only from their own community.
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const ADMIN = 'admin@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; name: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  status: string;
}
interface CarrierBody {
  id: string;
}
interface ReviewBody {
  id: string;
  orderId: string;
  shopId: string;
  rating: number;
  text: string | null;
  images: { id: string }[];
  editableUntil: string;
  deletedAt: string | null;
  deletionReason: string | null;
  createdAt: string;
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

async function createCarrier(superAdmin: Agent, name: string): Promise<CarrierBody> {
  const response = await superAdmin
    .post(`${API}/shipping-carriers`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name });

  return response.body as CarrierBody;
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

async function approvedProduct(
  superAdmin: Agent,
  seller: Agent,
  categoryId: string,
  name: string,
  variantName: string,
  priceAmountMinor: number,
  stock: number,
): Promise<ProductBody> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name,
      description: 'คำอธิบายสินค้าสำหรับทดสอบ',
      categoryId,
      variants: [{ name: variantName, priceAmountMinor, stock }],
    });
  const productId = (created.body as { id: string }).id;
  await approveProduct(superAdmin, productId);

  const fetched = await seller.get(`${API}/products/${productId}`);

  return fetched.body as ProductBody;
}

async function aRealSubdistrictPostalCodeId(app: TestApp): Promise<string> {
  const row = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  return row.id;
}

async function createAddress(app: TestApp, client: Agent): Promise<string> {
  const subdistrictPostalCodeId = await aRealSubdistrictPostalCodeId(app);
  const response = await client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ recipientName: 'สมชาย ใจดี', phone: '0812345678', houseNumber: '99/9', subdistrictPostalCodeId });

  return (response.body as { id: string }).id;
}

async function placeOrder(app: TestApp, buyer: Agent, variantId: string, quantity = 1): Promise<OrderBody> {
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity });
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

async function uploadSlip(buyer: Agent, orderId: string): Promise<void> {
  await buyer
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .attach('file', await aJpegBuffer(), 'slip.jpg');
}

async function confirmPayment(seller: Agent, orderId: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/confirm-payment`)
    .set(CSRF_HEADER, await csrfToken(seller));
}

async function ship(seller: Agent, orderId: string, carrierId: string) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/ship`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingCarrierId: carrierId, trackingNumber: 'TH1234567890' });
}

async function receive(buyer: Agent, orderId: string) {
  return buyer.post(`${API}/orders/${orderId}/receive`).set(CSRF_HEADER, await csrfToken(buyer));
}

async function writeReview(buyer: Agent, orderId: string, rating: number, text?: string) {
  return buyer
    .post(`${API}/orders/${orderId}/review`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ rating, ...(text !== undefined ? { text } : {}) });
}

async function editReview(buyer: Agent, orderId: string, rating: number, text?: string) {
  return buyer
    .patch(`${API}/orders/${orderId}/review`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ rating, ...(text !== undefined ? { text } : {}) });
}

async function deleteReview(admin: Agent, reviewId: string, reason: string) {
  return admin
    .delete(`${API}/reviews/${reviewId}`)
    .set(CSRF_HEADER, await csrfToken(admin))
    .send({ reason });
}

/** Order placed, paid, shipped and received — status COMPLETED, ready to review. */
async function orderCompleted(
  app: TestApp,
): Promise<{ superAdmin: Agent; seller: Agent; shopId: string; communityId: string; buyer: Agent; order: OrderBody }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const carrier = await createCarrier(superAdmin, 'Kerry');
  const { seller, shopId } = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบรีวิว', 'สีแดง', 10000, 5);
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
  await setShippingFee(seller, order.id, 2000);
  await uploadSlip(buyer, order.id);
  await confirmPayment(seller, order.id);
  await ship(seller, order.id, carrier.id);
  const received = await receive(buyer, order.id);

  return { superAdmin, seller, shopId, communityId, buyer, order: received.body as OrderBody };
}

describe('writing a review — only after the order is received, one per order (#60, F2)', () => {
  it('lets the buyer write a review after receiving, with rating mandatory and text optional', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);

    const response = await writeReview(buyer, order.id, 5, 'สินค้าดีมาก ส่งไว');

    expect(response.status).toBe(201);
    const body = response.body as ReviewBody;
    expect(body.rating).toBe(5);
    expect(body.text).toBe('สินค้าดีมาก ส่งไว');
    expect(body.orderId).toBe(order.id);
    expect(body.images).toEqual([]);
    // No author identity anywhere in the shape — reviews are anonymous by design.
    expect(body).not.toHaveProperty('buyerId');
  });

  it('lets a review be written with no text at all — only rating is mandatory', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);

    const response = await writeReview(buyer, order.id, 4);

    expect(response.status).toBe(201);
    expect((response.body as ReviewBody).text).toBeNull();
  });

  it('refuses before the order has been received', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const carrier = await createCarrier(superAdmin, 'Kerry');
    const { seller } = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบ', 'แบบเดียว', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);
    await setShippingFee(seller, order.id, 2000);
    await uploadSlip(buyer, order.id);
    await confirmPayment(seller, order.id);
    await ship(seller, order.id, carrier.id); // SHIPPED, not received yet

    const response = await writeReview(buyer, order.id, 5);

    expect(response.status).toBe(409);
  });

  it('refuses writing a second review for the same order', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 5);

    const response = await writeReview(buyer, order.id, 1);

    expect(response.status).toBe(409);
  });

  it('refuses reviewing someone else’s order', async () => {
    const app = getApp();
    const { order } = await orderCompleted(app);
    const otherBuyer = newClient(app);
    await registerAndLogin(otherBuyer, 'other-buyer@example.test');

    const response = await writeReview(otherBuyer, order.id, 5);

    expect(response.status).toBe(404);
  });

  it('🚨 I18b: lets the buyer write a review 30 days after receiving — no cap besides having received', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);

    app.clock.advanceByDays(30);
    // Access tokens are short-lived — log back in before the next HTTP call (HANDOFF.md caveat).
    await registerAndLogin(buyer, BUYER);

    const response = await writeReview(buyer, order.id, 5);

    expect(response.status).toBe(201);
  });
});

describe('editing a review — 7 days from when it was written, not from receiving it (#60, I18)', () => {
  it('lets the buyer edit within the window', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 3, 'เฉยๆ');

    const response = await editReview(buyer, order.id, 5, 'จริงๆ ดีมาก แก้ใจ');

    expect(response.status).toBe(200);
    const body = response.body as ReviewBody;
    expect(body.rating).toBe(5);
    expect(body.text).toBe('จริงๆ ดีมาก แก้ใจ');
  });

  it('🚨 I18 boundary: editable 6 days after writing, refused 8 days after writing', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 3);

    app.clock.advanceByDays(6);
    await registerAndLogin(buyer, BUYER);
    const withinWindow = await editReview(buyer, order.id, 4);
    expect(withinWindow.status).toBe(200);

    app.clock.advanceByDays(2); // total 8 days since writing
    await registerAndLogin(buyer, BUYER);
    const pastWindow = await editReview(buyer, order.id, 5);

    expect(pastWindow.status).toBe(409);
  });

  it('does not let editing reset the 7-day window — the deadline is fixed from the original write', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 3);

    app.clock.advanceByDays(6);
    await registerAndLogin(buyer, BUYER);
    await editReview(buyer, order.id, 4); // edit #1, still within window

    app.clock.advanceByDays(2); // total 8 days since the *original* write
    await registerAndLogin(buyer, BUYER);
    const response = await editReview(buyer, order.id, 5);

    expect(response.status).toBe(409);
  });

  it('refuses editing an order with no review yet', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);

    const response = await editReview(buyer, order.id, 5);

    expect(response.status).toBe(404);
  });
});

describe('review photos — up to 5, public to read (#60, K10)', () => {
  it('adds up to 5 photos and refuses a 6th', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 5);

    for (let i = 0; i < 5; i++) {
      const response = await buyer
        .post(`${API}/orders/${order.id}/review/images`)
        .set(CSRF_HEADER, await csrfToken(buyer))
        .attach('file', await aJpegBuffer(), `photo${i}.jpg`);
      expect(response.status).toBe(200);
    }

    const sixth = await buyer
      .post(`${API}/orders/${order.id}/review/images`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', await aJpegBuffer(), 'photo6.jpg');

    expect(sixth.status).toBe(409);
  });

  it('serves a review photo publicly, no session required', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 5);
    const withImage = await buyer
      .post(`${API}/orders/${order.id}/review/images`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', await aJpegBuffer(), 'photo.jpg');
    const reviewId = (withImage.body as ReviewBody).id;
    const imageId = (withImage.body as ReviewBody).images[0]!.id;

    const response = await newClient(app).get(`${API}/reviews/${reviewId}/images/${imageId}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/');
  });
});

describe('reading reviews — public, no session, excludes admin-deleted ones (#60)', () => {
  it('lists a shop’s reviews with no session, newest first', async () => {
    const app = getApp();
    const { shopId, buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 5, 'เยี่ยม');

    const response = await newClient(app).get(`${API}/shops/${shopId}/reviews`);

    expect(response.status).toBe(200);
    const body = response.body as { items: ReviewBody[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.rating).toBe(5);
  });

  it('computes the shop’s average rating and review count on the public shop page', async () => {
    const app = getApp();
    const { shopId, buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 4);

    const response = await newClient(app).get(`${API}/shops/${shopId}`);

    expect(response.status).toBe(200);
    const body = response.body as { averageRating: number | null; reviewCount: number };
    expect(body.averageRating).toBe(4);
    expect(body.reviewCount).toBe(1);
  });

  it('shows null averageRating and 0 reviewCount for a shop with no reviews', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนไม่มีรีวิว');
    const { shopId } = await sellerWithShop(app, SELLER, communityId);

    const response = await newClient(app).get(`${API}/shops/${shopId}`);

    const body = response.body as { averageRating: number | null; reviewCount: number };
    expect(body.averageRating).toBeNull();
    expect(body.reviewCount).toBe(0);
  });
});

describe('deleting a review — community admin only, with a reason, never the author or the shop (#60, L3)', () => {
  async function assignCommunityAdmin(superAdmin: Agent, communityId: string, adminEmail: string, app: TestApp): Promise<Agent> {
    const admin = newClient(app);
    const adminSession = await registerAndLogin(admin, adminEmail);
    const adminId = (adminSession.body as { id: string }).id;
    await superAdmin
      .post(`${API}/communities/${communityId}/admins`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ userId: adminId });

    return admin;
  }

  it('lets a community admin delete a review with a reason, recorded in audit_log', async () => {
    const app = getApp();
    const { superAdmin, communityId, buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1, 'ข้อความไม่เหมาะสม');
    const reviewId = (written.body as ReviewBody).id;
    const admin = await assignCommunityAdmin(superAdmin, communityId, ADMIN, app);

    const response = await deleteReview(admin, reviewId, 'ข้อความมีคำหยาบและพาดพิงบุคคลอื่น');

    expect(response.status).toBe(200);
    const body = response.body as ReviewBody;
    expect(body.deletedAt).not.toBeNull();
    expect(body.deletionReason).toBe('ข้อความมีคำหยาบและพาดพิงบุคคลอื่น');

    const entry = await app.prisma.auditLog.findFirst({ where: { action: 'REVIEW_DELETED', targetId: reviewId } });
    expect(entry).not.toBeNull();
  });

  it('refuses without a reason', async () => {
    const app = getApp();
    const { superAdmin, communityId, buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1);
    const reviewId = (written.body as ReviewBody).id;
    const admin = await assignCommunityAdmin(superAdmin, communityId, ADMIN, app);

    const response = await admin.delete(`${API}/reviews/${reviewId}`).set(CSRF_HEADER, await csrfToken(admin)).send({});

    expect(response.status).toBe(400);
  });

  it('removes the review from the public list and excludes it from the average, but keeps the row', async () => {
    const app = getApp();
    const { superAdmin, shopId, communityId, buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1);
    const reviewId = (written.body as ReviewBody).id;
    const admin = await assignCommunityAdmin(superAdmin, communityId, ADMIN, app);
    await deleteReview(admin, reviewId, 'ผิดกฎของชุมชน');

    const list = await newClient(app).get(`${API}/shops/${shopId}/reviews`);
    expect((list.body as { items: ReviewBody[] }).items).toHaveLength(0);

    const shop = await newClient(app).get(`${API}/shops/${shopId}`);
    expect((shop.body as { averageRating: number | null }).averageRating).toBeNull();

    const row = await app.prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.rating).toBe(1);
    expect(row.deletedAt).not.toBeNull();
  });

  it('still shows a deleted review, and why, to its own buyer', async () => {
    const app = getApp();
    const { superAdmin, communityId, buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1);
    const reviewId = (written.body as ReviewBody).id;
    const admin = await assignCommunityAdmin(superAdmin, communityId, ADMIN, app);
    await deleteReview(admin, reviewId, 'ผิดกฎของชุมชน');

    const response = await buyer.get(`${API}/orders/${order.id}`);

    const review = (response.body as { review: ReviewBody }).review;
    expect(review.deletedAt).not.toBeNull();
    expect(review.deletionReason).toBe('ผิดกฎของชุมชน');
  });

  it('🚨 refuses a community admin ก. deleting a review of a shop in community ข.', async () => {
    const app = getApp();
    const { superAdmin, buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1);
    const reviewId = (written.body as ReviewBody).id;
    const otherCommunityId = await createCommunity(superAdmin, 'ชุมชนอื่น');
    const admin = await assignCommunityAdmin(superAdmin, otherCommunityId, ADMIN, app);

    const response = await deleteReview(admin, reviewId, 'พยายามลบข้ามชุมชน');

    expect(response.status).toBe(403);
  });

  it('refuses an ordinary signed-in user, and somebody not signed in at all', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1);
    const reviewId = (written.body as ReviewBody).id;

    const stranger = newClient(app);
    await registerAndLogin(stranger, 'stranger@example.test');
    const byStranger = await deleteReview(stranger, reviewId, 'พยายามลบโดยไม่มีสิทธิ์');
    expect(byStranger.status).toBe(403);

    const anon = newClient(app);
    const byAnon = await anon.delete(`${API}/reviews/${reviewId}`).send({ reason: 'ไม่มีสิทธิ์เลย' });
    expect(byAnon.status).toBe(401);
  });

  it('answers 409 deleting an already-deleted review, and 404 for one that never existed', async () => {
    const app = getApp();
    const { superAdmin, communityId, buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1);
    const reviewId = (written.body as ReviewBody).id;
    const admin = await assignCommunityAdmin(superAdmin, communityId, ADMIN, app);
    const first = await deleteReview(admin, reviewId, 'เหตุผลการลบครั้งแรก');
    expect(first.status).toBe(200);

    const second = await deleteReview(admin, reviewId, 'เหตุผลการลบครั้งที่สอง');
    expect(second.status).toBe(409);

    // A non-existent id resolves to no community at all — CommunityScopeGuard answers the same
    // FORBIDDEN it gives a real target in a community this admin doesn't administer (deliberately,
    // so a caller can't tell "doesn't exist" from "exists elsewhere" by watching the status code).
    const missing = await deleteReview(admin, newId(), 'ไม่มีรีวิวนี้อยู่จริง');
    expect(missing.status).toBe(403);

    // Super admin skips the guard's resolver entirely (invariant 1), so the service's own
    // NOT_FOUND is what a real caller reaches for a genuinely nonexistent id.
    const missingAsSuper = await deleteReview(superAdmin, newId(), 'ไม่มีรีวิวนี้อยู่จริง');
    expect(missingAsSuper.status).toBe(404);
  });
});

describe('nobody can delete their own review, or the shop’s (#60, L3) — no such route exists', () => {
  it('the buyer has no delete route on their own review — only edit', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1);
    const reviewId = (written.body as ReviewBody).id;

    // The only DELETE route is /reviews/:id, gated on community-admin — a plain buyer hits 403,
    // never a success, proving there is no "delete my own review" path at all.
    const response = await buyer.delete(`${API}/reviews/${reviewId}`).set(CSRF_HEADER, await csrfToken(buyer)).send({ reason: 'ไม่ชอบใจแล้ว' });

    expect(response.status).toBe(403);
    const row = await app.prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.deletedAt).toBeNull();
  });

  it('the shop owner has no delete route on a review of their own shop', async () => {
    const app = getApp();
    const { seller, buyer, order } = await orderCompleted(app);
    const written = await writeReview(buyer, order.id, 1);
    const reviewId = (written.body as ReviewBody).id;

    const response = await seller.delete(`${API}/reviews/${reviewId}`).set(CSRF_HEADER, await csrfToken(seller)).send({ reason: 'รีวิวไม่ดี' });

    expect(response.status).toBe(403);
  });
});

describe('error shape for a missing rating', () => {
  it('answers VALIDATION_FAILED', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);

    const response = await buyer
      .post(`${API}/orders/${order.id}/review`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .send({});

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_FAILED');
  });
});

describe('code review of topic 9 (§85)', () => {
  async function adminOf(app: TestApp, superAdmin: Agent, communityId: string, email: string): Promise<Agent> {
    const admin = newClient(app);
    const session = await registerAndLogin(admin, email);
    await superAdmin
      .post(`${API}/communities/${communityId}/admins`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ userId: (session.body as { id: string }).id });

    return admin;
  }

  async function addImage(buyer: Agent, orderId: string) {
    return buyer
      .post(`${API}/orders/${orderId}/review/images`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', await aJpegBuffer(), 'photo.jpg');
  }

  it('a shop owner who later became a community admin still cannot delete a review of their own (closed) shop — N28', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, communityId, buyer, order } = await orderCompleted(app);
    const reviewId = ((await writeReview(buyer, order.id, 1, 'ของไม่ตรงปก')).body as ReviewBody).id;
    await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller));
    const sellerId = ((await seller.get(`${API}/auth/me`)).body as { id: string }).id;
    const assigned = await superAdmin
      .post(`${API}/communities/${communityId}/admins`)
      .set(CSRF_HEADER, await csrfToken(superAdmin))
      .send({ userId: sellerId });
    expect(assigned.status).toBe(201);

    const response = await deleteReview(seller, reviewId, 'รีวิวนี้ไม่เป็นธรรมกับร้านเลย');

    expect(response.status).toBe(403);
    const list = await newClient(app).get(`${API}/shops/${shopId}/reviews`);
    expect((list.body as { items: ReviewBody[] }).items).toHaveLength(1);
  });

  it('a deleted review’s photos stop being served publicly (L3)', async () => {
    const app = getApp();
    const { superAdmin, buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 1);
    const withImage = (await addImage(buyer, order.id)).body as ReviewBody;
    const imageId = withImage.images[0]!.id;
    await deleteReview(superAdmin, withImage.id, 'รูปผิดกฎของชุมชนอย่างชัดเจน');

    const response = await newClient(app).get(`${API}/reviews/${withImage.id}/images/${imageId}`);

    expect(response.status).toBe(404);
  });

  it('two photo uploads at once at four photos: one lands, one is refused, and the refused file is not left on disk (K10)', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 5);
    for (let i = 0; i < 4; i += 1) {
      await addImage(buyer, order.id);
    }

    const results = await Promise.all([addImage(buyer, order.id), addImage(buyer, order.id)]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const review = ((await buyer.get(`${API}/orders/${order.id}`)).body as { review: ReviewBody }).review;
    expect(review.images).toHaveLength(5);
    // Five photos + the one payment slip the fixture uploaded — nothing orphaned by the loser.
    expect(await app.prisma.uploadedFile.count()).toBe(6);
  });

  it('two admins deleting the same review at once: one succeeds, the other gets 409, one audit entry carrying the community', async () => {
    const app = getApp();
    const { superAdmin, communityId, buyer, order } = await orderCompleted(app);
    const reviewId = ((await writeReview(buyer, order.id, 1)).body as ReviewBody).id;
    const admin = await adminOf(app, superAdmin, communityId, ADMIN);

    const results = await Promise.all([
      deleteReview(admin, reviewId, 'ผิดกฎข้อหนึ่งของชุมชน'),
      deleteReview(superAdmin, reviewId, 'ผิดกฎข้อสองของชุมชน'),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const entries = await app.prisma.auditLog.findMany({ where: { action: 'REVIEW_DELETED', targetId: reviewId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.communityId).toBe(communityId);
  });

  it('an edit that lands just after an admin deleted the review is refused, not written over the removed text', async () => {
    const app = getApp();
    const { superAdmin, buyer, order } = await orderCompleted(app);
    const reviewId = ((await writeReview(buyer, order.id, 1, 'ข้อความผิดกฎ')).body as ReviewBody).id;
    const original = app.prisma.review.findFirst.bind(app.prisma.review);
    let deleted = 0;
    vi.spyOn(app.prisma.review, 'findFirst').mockImplementationOnce((async (args: unknown) => {
      const read = await original(args as never);
      deleted = (await deleteReview(superAdmin, reviewId, 'ผิดกฎของชุมชนอย่างชัดเจน')).status;
      return read;
    }) as never);

    const response = await editReview(buyer, order.id, 5, 'แก้ให้ดูดี');

    expect(deleted).toBe(200);
    expect(response.status).toBe(409);
    const review = ((await buyer.get(`${API}/orders/${order.id}`)).body as { review: ReviewBody }).review;
    expect(review.text).toBe('ข้อความผิดกฎ');
  });

  it('the rating follows the person across a close-and-reopen, the same way disputeLostCount does (I12)', async () => {
    const app = getApp();
    const { superAdmin, seller, shopId, buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 1, 'ของแย่มาก');
    await seller.post(`${API}/shops/${shopId}/close`).set(CSRF_HEADER, await csrfToken(seller));
    const otherCommunity = await createCommunity(superAdmin, 'ชุมชนศรีราชา');
    const reopened = await seller.post(`${API}/shops`).set(CSRF_HEADER, await csrfToken(seller)).send({ communityId: otherCommunity, name: 'ร้านใหม่' });
    const newShopId = (reopened.body as { id: string }).id;
    await approveShopAs(superAdmin, newShopId);

    const shop = (await newClient(app).get(`${API}/shops/${newShopId}`)).body as { averageRating: number | null; reviewCount: number };
    const list = (await newClient(app).get(`${API}/shops/${newShopId}/reviews`)).body as { items: ReviewBody[] };

    expect(shop).toMatchObject({ averageRating: 1, reviewCount: 1 });
    expect(list.items).toHaveLength(1);
  });

  it('a review can still be written while a dispute on the order is open (I18c)', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    const opened = await buyer
      .post(`${API}/orders/${order.id}/dispute`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .field('reason', 'ของที่ได้รับชำรุดตั้งแต่แกะกล่อง')
      .attach('files', await aJpegBuffer(), 'evidence.jpg');
    expect(opened.status).toBe(201);

    const response = await writeReview(buyer, order.id, 2, 'ของชำรุด รอผลข้อพิพาท');

    expect(response.status).toBe(201);
  });

  it('a review photo comes back without the EXIF block it was uploaded with', async () => {
    const app = getApp();
    const { buyer, order } = await orderCompleted(app);
    await writeReview(buyer, order.id, 5);
    const withExif = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 200 } } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'GPS-and-camera-data' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const uploaded = (await buyer
      .post(`${API}/orders/${order.id}/review/images`)
      .set(CSRF_HEADER, await csrfToken(buyer))
      .attach('file', withExif, 'photo.jpg')).body as ReviewBody;

    const served = await newClient(app).get(`${API}/reviews/${uploaded.id}/images/${uploaded.images[0]!.id}`).buffer(true);

    expect((await sharp(served.body as Buffer).metadata()).exif).toBeUndefined();
  });
});
